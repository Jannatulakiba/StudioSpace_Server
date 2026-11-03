require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === "production";
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");

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
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

/* ---------------- ছোট helper ---------------- */
const fail = (res, code, message) => res.status(code).send({ message });
const ser = (d) => ({ ...d, _id: d._id.toString() });
const oid = (id) => new ObjectId(id);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 24;
const NUMS = ["hourlyRate", "deposit", "capacity"];

// :id আছে এমন সব route-এ একবারেই id যাচাই
app.param("id", (req, res, next, id) =>
  ObjectId.isValid(id) ? next() : fail(res, 400, "Invalid id")
);

/* ---------------- db ---------------- */
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

/* ---------------- auth ---------------- */
const AUTH_URL = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
};

// BetterAuth-এর JWT, তার public key (JWKS) দিয়ে যাচাই
let joseLib, jwks;
async function verifyAuthToken(token) {
  joseLib ||= await import("jose");
  jwks ||= joseLib.createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));
  const { payload } = await joseLib.jwtVerify(token, jwks, { issuer: AUTH_URL, audience: AUTH_URL });
  return payload;
}

const verifyToken = (req, res, next) => {
  try {
    req.user = jwt.verify(req.cookies?.token, process.env.JWT_SECRET, { audience: "studiospace-api" });
    next();
  } catch {
    fail(res, 401, "Unauthorized");
  }
};

// সব route-এর জন্য একটাই function:
//   handle(fn)        → login লাগবে (verifyToken) + error হলে 500
//   handle(fn, false) → খোলা route + error হলে 500
const handle = (fn, auth = true) => [
  ...(auth ? [verifyToken] : []),
  (req, res) =>
    fn(req, res).catch((e) => {
      console.error(e);
      fail(res, 500, "Server error");
    }),
];

// studio-র মালিক না হলে error পাঠিয়ে null ফেরত দেয়
const ownStudio = async (req, res) => {
  const s = await (await col("studios")).findOne({ _id: oid(req.params.id) });
  if (!s) fail(res, 404, "Studio not found");
  else if (s.ownerEmail !== req.user.email) fail(res, 403, "Forbidden: this is not your studio");
  else return s;
  return null;
};

app.post(
  "/api/jwt",
  handle(async (req, res) => {
    if (!req.body.token) return fail(res, 400, "token is required");
    let p;
    try {
      p = await verifyAuthToken(req.body.token);
    } catch (e) {
      console.error("Auth token verify failed:", e.message);
      return fail(res, 401, "Invalid or expired token");
    }
    if (!p.email) return fail(res, 401, "Token has no email");

    const apiToken = jwt.sign({ email: p.email, name: p.name }, process.env.JWT_SECRET, {
      expiresIn: "7d",
      audience: "studiospace-api",
    });
    res.cookie("token", apiToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 }).send({ ok: true });
  }, false)
);

app.post("/api/logout", handle(async (req, res) => {
  res.clearCookie("token", cookieOpts).send({ ok: true });
}, false));

/* ---------------- STUDIOS ---------------- */
app.get("/api/studios", handle(async (req, res) => {
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
  let cursor = (await col("studios")).find(query).sort(sorts[sort] || sorts.newest);
  if (limit) cursor = cursor.limit(Math.min(Number(limit) || 20, 100));
  res.send((await cursor.toArray()).map(ser));
}, false));

app.get("/api/studios/:id", handle(async (req, res) => {
  const s = await (await col("studios")).findOne({ _id: oid(req.params.id) });
  s ? res.send(ser(s)) : fail(res, 404, "Studio not found");
}, false));

app.post("/api/studios", handle(async (req, res) => {
  const { _id, rating, createdAt, ownerEmail, ownerName, ...d } = req.body;
  if (!d.title) return fail(res, 400, "Title is required");

  const doc = {
    ...d,
    ownerEmail: req.user.email, // body নয়, token থেকে
    ownerName: req.user.name || ownerName || "",
    reviews: Array.isArray(d.reviews) ? d.reviews : [],
    rating: 0,
    createdAt: new Date().toISOString(),
  };
  NUMS.forEach((k) => (doc[k] = Number(d[k])));
  if (NUMS.some((k) => Number.isNaN(doc[k]))) return fail(res, 400, "hourlyRate, deposit and capacity must be numbers");

  const r = await (await col("studios")).insertOne(doc);
  res.status(201).send({ ...doc, _id: r.insertedId.toString() });
}));

app.put("/api/studios/:id", handle(async (req, res) => {
  if (!(await ownStudio(req, res))) return;
  const { _id, rating, reviews, createdAt, ownerEmail, ownerName, ...patch } = req.body;
  if (!Object.keys(patch).length) return fail(res, 400, "Nothing to update");

  const bad = NUMS.find((k) => patch[k] !== undefined && Number.isNaN((patch[k] = Number(patch[k]))));
  if (bad) return fail(res, 400, `${bad} must be a number`);

  await (await col("studios")).updateOne({ _id: oid(req.params.id) }, { $set: patch });
  res.send({ ok: true });
}));

app.delete("/api/studios/:id", handle(async (req, res) => {
  if (!(await ownStudio(req, res))) return;
  await (await col("studios")).deleteOne({ _id: oid(req.params.id) });
  res.send({ ok: true });
}));

app.post("/api/studios/:id/reviews", handle(async (req, res) => {
  const rating = Number(req.body.rating);
  const { comment } = req.body;
  if (!comment || !rating || rating < 1 || rating > 5) return fail(res, 400, "Rating (1-5) and comment are required");

  const studios = await col("studios");
  const _id = oid(req.params.id);
  const review = {
    userName: req.user.name || "Guest",
    userEmail: req.user.email,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  };
  const pushed = await studios.updateOne({ _id }, { $push: { reviews: review } });
  if (!pushed.matchedCount) return fail(res, 404, "Studio not found");

  const list = (await studios.findOne({ _id }))?.reviews || [];
  if (list.length) {
    const avg = list.reduce((sum, x) => sum + x.rating, 0) / list.length;
    await studios.updateOne({ _id }, { $set: { rating: Math.round(avg * 10) / 10 } });
  }
  res.status(201).send(review);
}));

/* ---------------- USERS ---------------- */
app.post("/api/users", handle(async (req, res) => {
  const { name, image } = req.body;
  const now = new Date().toISOString();
  await (await col("users")).updateOne(
    { email: req.user.email },
    {
      $set: { image: image || "", lastLoginAt: now, ...(name && { name }) },
      $setOnInsert: { role: "user", createdAt: now },
    },
    { upsert: true }
  );
  res.send({ ok: true });
}));

app.get("/api/users/:email", handle(async (req, res) => {
  if (req.params.email !== req.user.email) return fail(res, 403, "Forbidden");
  const u = await (await col("users")).findOne({ email: req.params.email });
  u ? res.send(ser(u)) : fail(res, 404, "User not found");
}));

/* ---------------- BOOKINGS ---------------- */
app.get("/api/bookings", handle(async (req, res) => {
  const list = await (await col("bookings"))
    .find({ userEmail: req.user.email }) // শুধু নিজের
    .sort({ createdAt: -1 })
    .toArray();
  res.send(list.map(ser));
}));

app.post("/api/bookings", handle(async (req, res) => {
  const { studioId, date } = req.body;
  const start = Number(req.body.startHour);
  const end = Number(req.body.endHour);

  if (!ObjectId.isValid(studioId)) return fail(res, 400, "Invalid studio");
  if (!date) return fail(res, 400, "date is required");
  if (!validHour(start) || !validHour(end)) return fail(res, 400, "Hours must be between 0 and 24.");
  if (end <= start) return fail(res, 400, "End time must be after start time.");

  const studio = await (await col("studios")).findOne({ _id: oid(studioId) });
  if (!studio) return fail(res, 404, "Studio not found");

  const bookings = await col("bookings");
  const clash = await bookings.findOne({
    studioId,
    date,
    status: "Confirmed",
    startHour: { $lt: end },
    endHour: { $gt: start },
  });
  if (clash) return fail(res, 409, `Already booked from ${clash.startHour}:00 to ${clash.endHour}:00 on this date. Pick another slot.`);

  const doc = {
    studioId,
    studioTitle: studio.title,
    userEmail: req.user.email, // body নয়, token থেকে
    date,
    startHour: start,
    endHour: end,
    total: (end - start) * studio.hourlyRate,
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  const r = await bookings.insertOne(doc);
  res.status(201).send({ ...doc, _id: r.insertedId.toString() });
}));

app.patch("/api/bookings/:id/cancel", handle(async (req, res) => {
  const r = await (await col("bookings")).updateOne(
    { _id: oid(req.params.id), status: "Pending", userEmail: req.user.email },
    { $set: { status: "Cancelled" } }
  );
  r.matchedCount ? res.send({ ok: true }) : fail(res, 404, "Pending booking not found");
}));

// শুধু studio-র host confirm করতে পারবে
app.patch("/api/bookings/:id/confirm", handle(async (req, res) => {
  const bookings = await col("bookings");
  const _id = oid(req.params.id);

  const b = await bookings.findOne({ _id, status: "Pending" });
  if (!b) return fail(res, 404, "Pending booking not found");

  const studio = ObjectId.isValid(b.studioId) ? await (await col("studios")).findOne({ _id: oid(b.studioId) }) : null;
  if (!studio || studio.ownerEmail !== req.user.email) return fail(res, 403, "Only the studio host can confirm");

  const clash = await bookings.findOne({
    _id: { $ne: _id },
    studioId: b.studioId,
    date: b.date,
    status: "Confirmed",
    startHour: { $lt: b.endHour },
    endHour: { $gt: b.startHour },
  });
  if (clash) return fail(res, 409, `Slot already confirmed from ${clash.startHour}:00 to ${clash.endHour}:00.`);

  await bookings.updateOne({ _id, status: "Pending" }, { $set: { status: "Confirmed" } });
  res.send({ ok: true });
}));

app.get("/", (req, res) => res.send({ status: "StudioSpace server running" }));
app.use((req, res) => fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`));

if (require.main === module) {
  app.listen(port, () => console.log(`Server on port ${port}`));
}
module.exports = app;