require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

const allowed = [
  "http://localhost:3000",
  "https://a8-studio-space.vercel.app",
  "https://studiospace-mu.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowed,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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


const mk = (n, images, title, category, hourlyRate, deposit, capacity, location, rating, amenities, ownerName, ownerEmail, overview) => ({
  title, category, hourlyRate, deposit, capacity, location,
  images: images.map((x) => `/studios/${x}.jpg`),
  amenities, overview, rating, ownerName, ownerEmail,
  reviews: [
    { userName: "Ayesha Khan", rating: 5, comment: "Perfect space, the host was very helpful.", createdAt: new Date(2026, 9, 20).toISOString() },
    { userName: "Sabbir Hasan", rating: 4, comment: "Great equipment and easy booking.", createdAt: new Date(2026, 9, 12).toISOString() },
  ],
  createdAt: new Date(2026, 9, 30 - n).toISOString(),
});

const demoStudios = () => [
  mk(1, [4, 2, 1], "North Light Cyc Wall", "Photo Studio", 55, 100, 12, "Gulshan, Dhaka", 4.9, ["Wi-Fi", "Lighting kit", "Parking", "Changing room"], "Tanvir Rahman", "tanvir@host.com", "A 20 ft white cyc wall with daylight windows and two strobe heads. Ideal for product, fashion and portrait shoots."),
  mk(2, [5, 3, 1], "Monsoon Podcast Lounge", "Podcast Lounge", 30, 50, 5, "Dhanmondi, Dhaka", 4.8, ["Wi-Fi", "Acoustic panels", "Kitchenette"], "Nusrat Jahan", "nusrat@host.com", "Four-mic setup with treated walls and a sofa corner, ready for interviews and video podcasts."),
  mk(3, [2, 4, 3], "Stage 9 Cinema Floor", "Film Stage", 120, 300, 40, "Uttara, Dhaka", 4.7, ["Green screen", "Lighting kit", "Parking", "Blackout curtains"], "Imran Hossain", "imran@host.com", "1,800 sq ft soundproofed stage with a drive-in door and a built-in grid for rigging lights."),
  mk(4, [1, 3, 5], "Padma Recording Suite", "Music Suite", 45, 120, 8, "Banani, Dhaka", 4.9, ["Acoustic panels", "Wi-Fi", "Kitchenette"], "Rafi Ahmed", "rafi@host.com", "Control room and live room with a vocal booth, 16-channel console and a grand piano."),
  mk(5, [4, 1, 2], "Clay and Canvas Workshop", "Workshop", 25, 40, 15, "Agrabad, Chattogram", 4.6, ["Wi-Fi", "Kitchenette", "Parking"], "Sadia Islam", "sadia@host.com", "Bright workshop with long tables, a kiln and wall space for painting and ceramics classes."),
  mk(6, [2, 5, 4], "Blue Hour Loft", "Photo Studio", 40, 80, 10, "Sylhet Sadar", 4.5, ["Wi-Fi", "Lighting kit", "Changing room"], "Mahin Chowdhury", "mahin@host.com", "Brick-wall loft with big windows, props and a small set kitchen for lifestyle shoots."),
  mk(7, [5, 2, 3], "Echo Room Voiceover Booth", "Podcast Lounge", 20, 30, 3, "Khulna Sadar", 4.4, ["Acoustic panels", "Wi-Fi"], "Farhan Kabir", "farhan@host.com", "Compact isolation booth for voiceover, dubbing and narration, with a large-diaphragm mic on hand."),
  mk(8, [3, 1, 5], "Riverside Band Room", "Music Suite", 35, 60, 7, "Barishal Sadar", 4.6, ["Parking", "Acoustic panels", "Wi-Fi"], "Demo Examiner", "examiner@studiospace.com", "Rehearsal room with a full backline, drum kit and PA, plus a river view lounge."),
];


async function seedStudios(db) {
  const meta = db.collection("meta");
  try {
    await meta.insertOne({ _id: "studios-seeded", at: new Date().toISOString() });
  } catch (e) {
    if (e.code === 11000) return; 
    throw e;
  }
  try {
    const studios = db.collection("studios");
    if ((await studios.countDocuments()) === 0) {
      await studios.insertMany(demoStudios());
      console.log("Demo studios seeded");
    }
  } catch (e) {
    await meta.deleteOne({ _id: "studios-seeded" });
    throw e;
  }
}


let dbPromise;
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      await client.connect();
      const db = client.db("studiospace");
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await seedStudios(db);
      console.log("MongoDB connected");
      return db;
    })().catch((e) => {
      dbPromise = null; 
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


app.get("/", (req, res) => res.send({ status: "StudioSpace server running" }));

app.use((req, res) => res.status(404).send({ message: `Route not found: ${req.method} ${req.originalUrl}` }));

if (require.main === module) {
  app.listen(port, () => console.log(`Server on port ${port}`));
}
module.exports = app;

// if (process.env.VERCEL) {
//   module.exports = app;
// } else {
//   app.listen(port, () => console.log(`Server on port ${port}`));
// }