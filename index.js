require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

/* ---------------- config ---------------- */
const stripSlash = (u) => String(u || "").replace(/\/$/, "");

// BetterAuth (frontend) URL: JWT issuer/audience, JWKS source
const AUTH_URL = stripSlash(process.env.BETTER_AUTH_URL || "http://localhost:3000");

const allowed = [
  "http://localhost:3000",
  AUTH_URL,
  stripSlash(process.env.FRONTEND_URL),
].filter(Boolean);

app.use(
  cors({
    origin: [...new Set(allowed)],
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

/* ---------------- helper ---------------- */
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
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}
const col = async (name) => (await getDb()).collection(name);

/* ---------------- auth ---------------- */
// BetterAuth-এর JWT, তার public key (JWKS) দিয়ে যাচাই।
// BETTER_AUTH_JWKS env সেট থাকলে সেটা থেকেই local JWK set (prod fallback);
// নাহলে remote JWKS।
let joseLib, jwks, localJwks;
async function verifyAuthToken(token) {
  joseLib ||= await import("jose");
  const opts = { issuer: AUTH_URL, audience: AUTH_URL };
  const jwksJSON = process.env.BETTER_AUTH_JWKS;
  if (jwksJSON) {
    localJwks ||= joseLib.createLocalJWKSet(JSON.parse(jwksJSON));
    const { payload } = await joseLib.jwtVerify(token, localJwks, opts);
    return payload;
  }
  jwks ||= joseLib.createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));
  const { payload } = await joseLib.jwtVerify(token, jwks, opts);
  return payload;
}

const bearer = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, "");

// Authorization header আগে, না থাকলে HTTPOnly cookie
const verifyToken = async (req, res, next) => {
  const token = bearer(req) || req.cookies?.token;
  if (!token) return fail(res, 401, "Unauthorized");
  try {
    req.user = await verifyAuthToken(token);
    next();
  } catch (e) {
    console.error("Token verify failed:", e.message);
    fail(res, 401, "Unauthorized");
  }
};

//   handle(fn)        → login লাগবে + error হলে 500
//   handle(fn, false) → খোলা route + error হলে 500
const handle = (fn, auth = true) => [
  ...(auth ? [verifyToken] : []),
  (req, res) =>
    fn(req, res).catch((e) => {
      console.error(e);
      fail(res, 500, "Server error");
    }),
];

// token যাচাই করে HTTPOnly cookie-তে রাখে (নিজেই verify করে, তাই খোলা route)
app.post("/api/jwt", handle(async (req, res) => {
  const token = bearer(req);
  if (!token) return fail(res, 401, "Unauthorized");
  try {
    const user = await verifyAuthToken(token);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.status(201).send({ ok: true, user: { email: user.email, name: user.name } });
  } catch (e) {
    console.error("JWT exchange failed:", e?.message);
    fail(res, 401, "Unauthorized");
  }
}, false));

app.delete("/api/jwt", (req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "none", secure: true });
  res.send({ ok: true });
});

// studio-র মালিক না হলে error পাঠিয়ে null ফেরত দেয়
const ownStudio = async (req, res) => {
  const s = await (await col("studios")).findOne({ _id: oid(req.params.id) });
  if (!s) fail(res, 404, "Studio not found");
  else if (s.ownerEmail !== req.user.email) fail(res, 403, "Forbidden: this is not your studio");
  else return s;
  return null;
};

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
      $set: { image: image || "", lastLoginAt: now, ...((name || req.user.name) && { name: name || req.user.name }) },
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
  // ?asHost=1 → এই host-এর সব studio-র booking feed
  if (req.query.asHost) {
    const mine = await (await col("studios")).find({ ownerEmail: req.user.email }).toArray();
    const studioIds = mine.map((s) => s._id.toString());
    const list = await (await col("bookings"))
      .find({ studioId: { $in: studioIds } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.send(list.map(ser));
  }
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

  // Challenge 2: Confirmed booking-এর সঙ্গে overlap check
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

  const studio = ObjectId.isValid(b.studioId)
    ? await (await col("studios")).findOne({ _id: oid(b.studioId) })
    : null;
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

app.patch("/api/bookings/:id/complete", handle(async (req, res) => {
  const bookings = await col("bookings");
  const b = await bookings.findOne({ _id: oid(req.params.id), status: "Confirmed" });
  if (!b) return fail(res, 404, "Confirmed booking not found");

  const studio = ObjectId.isValid(b.studioId)
    ? await (await col("studios")).findOne({ _id: oid(b.studioId) })
    : null;
  if (!studio || studio.ownerEmail !== req.user.email) return fail(res, 403, "Only the studio host can complete");

  await bookings.updateOne({ _id: b._id }, { $set: { status: "Completed" } });
  res.send({ ok: true });
}));

/* ---------------- WISHLIST ---------------- */
app.get("/api/wishlist", handle(async (req, res) => {
  const u = await (await col("users")).findOne(
    { email: req.user.email },
    { projection: { wishlist: 1 } }
  );
  const ids = (u?.wishlist || []).filter((x) => ObjectId.isValid(x));
  if (!ids.length) return res.send([]);
  const docs = await (await col("studios")).find({ _id: { $in: ids.map(oid) } }).toArray();
  const map = new Map(docs.map((d) => [d._id.toString(), ser(d)]));
  res.send(ids.map((x) => map.get(x)).filter(Boolean)); // নিজের সেভ-এর order-এ
}));

app.post("/api/wishlist/:id", handle(async (req, res) => {
  const sid = String(req.params.id);
  const studio = await (await col("studios")).findOne({ _id: oid(sid) });
  if (!studio) return fail(res, 404, "Studio not found");

  await (await col("users")).updateOne(
    { email: req.user.email },
    {
      $addToSet: { wishlist: sid },
      $set: { name: req.user.name || "" },
      $setOnInsert: { role: "user", createdAt: new Date().toISOString() },
    },
    { upsert: true }
  );
  res.send({ ok: true, saved: true });
}));

app.delete("/api/wishlist/:id", handle(async (req, res) => {
  await (await col("users")).updateOne(
    { email: req.user.email },
    { $pull: { wishlist: String(req.params.id) } },
    { upsert: true }
  );
  res.send({ ok: true, saved: false });
}));

/* ---------------- misc ---------------- */
app.get("/", (req, res) => res.send({ status: "StudioSpace server running" }));
app.use((req, res) => fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`));

if (require.main === module) {
  app.listen(port, () => console.log(`Server on port ${port}`));
}
module.exports = app;