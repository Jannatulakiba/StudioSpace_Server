require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:3000", "https://a8-studiospace.onrender.com"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// এরর হলে request ঝুলে না থেকে 500 ফেরত দেবে
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).send({ message: "Server error" });
  });

// Lazy DB connection: Vercel/serverless এবং লোকাল দুই জায়গাতেই কাজ করবে
let dbPromise;
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      await client.connect();
      const db = client.db("studiospace");
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      console.log("MongoDB connected");
      return db;
    })().catch((e) => {
      dbPromise = null; // পরের request-এ আবার চেষ্টা করবে
      throw e;
    });
  }
  return dbPromise;
}

const col = async (name) => (await getDb()).collection(name);
const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 24;

// ---------- STUDIOS ----------
app.get(
  "/api/studios",
  wrap(async (req, res) => {
    const studios = await col("studios");
    const { search, category, owner, sort, limit } = req.query;
    const query = {};
    if (category) query.category = String(category);
    if (owner) query.ownerEmail = String(owner);
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      query.$or = [{ title: rx }, { location: rx }];
    }
    const sorts = {
      rating: { rating: -1 },
      newest: { createdAt: -1 },
      "price-asc": { hourlyRate: 1 },
      "price-desc": { hourlyRate: -1 },
    };
    let cursor = studios.find(query).sort(sorts[sort] || sorts.newest);
    if (limit) cursor = cursor.limit(Math.min(Number(limit) || 20, 100));
    const list = await cursor.toArray();
    res.send(list.map((s) => ({ ...s, _id: s._id.toString() })));
  })
);

app.get(
  "/api/studios/:id",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const studios = await col("studios");
    const s = await studios.findOne({ _id: new ObjectId(req.params.id) });
    if (!s) return res.status(404).send({ message: "Studio not found" });
    res.send({ ...s, _id: s._id.toString() });
  })
);

app.post(
  "/api/studios",
  wrap(async (req, res) => {
    const studios = await col("studios");
    // ক্লায়েন্ট যেন _id, rating, createdAt নিজে সেট করতে না পারে
    const { _id, rating, createdAt, ...d } = req.body;
    if (!d.title) return res.status(400).send({ message: "Title is required" });

    const doc = {
      ...d,
      hourlyRate: Number(d.hourlyRate),
      deposit: Number(d.deposit),
      capacity: Number(d.capacity),
      reviews: Array.isArray(d.reviews) ? d.reviews : [],
      rating: 0,
      createdAt: new Date().toISOString(),
    };
    if ([doc.hourlyRate, doc.deposit, doc.capacity].some((n) => Number.isNaN(n)))
      return res
        .status(400)
        .send({ message: "hourlyRate, deposit and capacity must be numbers" });

    const r = await studios.insertOne(doc);
    res.status(201).send({ ...doc, _id: r.insertedId.toString() });
  })
);

app.put(
  "/api/studios/:id",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const studios = await col("studios");
    const { _id, rating, reviews, createdAt, ...patch } = req.body;
    if (!Object.keys(patch).length)
      return res.status(400).send({ message: "Nothing to update" });

    for (const k of ["hourlyRate", "deposit", "capacity"]) {
      if (patch[k] !== undefined) {
        patch[k] = Number(patch[k]);
        if (Number.isNaN(patch[k]))
          return res.status(400).send({ message: `${k} must be a number` });
      }
    }

    const r = await studios.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: patch }
    );
    if (!r.matchedCount) return res.status(404).send({ message: "Studio not found" });
    res.send({ ok: true });
  })
);

app.delete(
  "/api/studios/:id",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const studios = await col("studios");
    const r = await studios.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).send({ message: "Studio not found" });
    res.send({ ok: true });
  })
);

// Review যোগ করা ও গড় rating আপডেট
app.post(
  "/api/studios/:id/reviews",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const { userName, userEmail, rating, comment } = req.body;
    const r = Number(rating);
    if (!comment || !r || r < 1 || r > 5)
      return res
        .status(400)
        .send({ message: "Rating (1-5) and comment are required" });

    const studios = await col("studios");
    const _id = new ObjectId(req.params.id);
    const review = {
      userName,
      userEmail,
      rating: r,
      comment,
      createdAt: new Date().toISOString(),
    };

    const pushed = await studios.updateOne({ _id }, { $push: { reviews: review } });
    if (!pushed.matchedCount)
      return res.status(404).send({ message: "Studio not found" });

    const s = await studios.findOne({ _id });
    const list = s?.reviews || [];
    if (list.length) {
      const avg = list.reduce((sum, x) => sum + x.rating, 0) / list.length;
      await studios.updateOne({ _id }, { $set: { rating: Math.round(avg * 10) / 10 } });
    }
    res.status(201).send(review);
  })
);

// ---------- USERS ----------
app.post(
  "/api/users",
  wrap(async (req, res) => {
    const { name, email, image } = req.body;
    if (!email) return res.status(400).send({ message: "Email is required" });

    const users = await col("users");
    const now = new Date().toISOString();
    const set = { image: image || "", lastLoginAt: now };
    if (name) set.name = name;

    await users.updateOne(
      { email },
      { $set: set, $setOnInsert: { role: "user", createdAt: now } },
      { upsert: true }
    );
    res.send({ ok: true });
  })
);

app.get(
  "/api/users/:email",
  wrap(async (req, res) => {
    const users = await col("users");
    const u = await users.findOne({ email: req.params.email });
    if (!u) return res.status(404).send({ message: "User not found" });
    res.send({ ...u, _id: u._id.toString() });
  })
);

// ---------- BOOKINGS ----------
app.get(
  "/api/bookings",
  wrap(async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).send({ message: "Email is required" });

    const bookings = await col("bookings");
    const list = await bookings
      .find({ userEmail: String(email) })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(list.map((b) => ({ ...b, _id: b._id.toString() })));
  })
);

app.post(
  "/api/bookings",
  wrap(async (req, res) => {
    const { studioId, userEmail, date } = req.body;
    const start = Number(req.body.startHour);
    const end = Number(req.body.endHour);

    if (!ObjectId.isValid(studioId))
      return res.status(400).send({ message: "Invalid studio" });
    if (!userEmail || !date)
      return res.status(400).send({ message: "userEmail and date are required" });
    if (!validHour(start) || !validHour(end))
      return res.status(400).send({ message: "Hours must be between 0 and 24." });
    if (end <= start)
      return res.status(400).send({ message: "End time must be after start time." });

    const studios = await col("studios");
    const bookings = await col("bookings");

    const studio = await studios.findOne({ _id: new ObjectId(studioId) });
    if (!studio) return res.status(404).send({ message: "Studio not found" });

    // Confirmed booking-এর সঙ্গে overlap check
    const clash = await bookings.findOne({
      studioId,
      date,
      status: "Confirmed",
      startHour: { $lt: end },
      endHour: { $gt: start },
    });
    if (clash)
      return res.status(409).send({
        message: `Already booked from ${clash.startHour}:00 to ${clash.endHour}:00 on this date. Pick another slot.`,
      });

    const doc = {
      studioId,
      studioTitle: studio.title,
      userEmail,
      date,
      startHour: start,
      endHour: end,
      total: (end - start) * studio.hourlyRate,
      status: "Pending",
      createdAt: new Date().toISOString(),
    };
    const r = await bookings.insertOne(doc);
    res.status(201).send({ ...doc, _id: r.insertedId.toString() });
  })
);

app.patch(
  "/api/bookings/:id/cancel",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const bookings = await col("bookings");
    const r = await bookings.updateOne(
      { _id: new ObjectId(req.params.id), status: "Pending" },
      { $set: { status: "Cancelled" } }
    );
    if (!r.matchedCount)
      return res.status(404).send({ message: "Pending booking not found" });
    res.send({ ok: true });
  })
);

// Pending booking Confirmed করা (confirm করার সময়ও overlap check)
app.patch(
  "/api/bookings/:id/confirm",
  wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ message: "Invalid id" });
    const bookings = await col("bookings");
    const _id = new ObjectId(req.params.id);

    const b = await bookings.findOne({ _id, status: "Pending" });
    if (!b) return res.status(404).send({ message: "Pending booking not found" });

    const clash = await bookings.findOne({
      _id: { $ne: _id },
      studioId: b.studioId,
      date: b.date,
      status: "Confirmed",
      startHour: { $lt: b.endHour },
      endHour: { $gt: b.startHour },
    });
    if (clash)
      return res.status(409).send({
        message: `Slot already confirmed from ${clash.startHour}:00 to ${clash.endHour}:00.`,
      });

    await bookings.updateOne({ _id, status: "Pending" }, { $set: { status: "Confirmed" } });
    res.send({ ok: true });
  })
);

app.get("/", (req, res) => res.send("StudioSpace server running"));

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, () => console.log(`Server on port ${port}`));
}