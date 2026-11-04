require("dotenv").config();
const { MongoClient } = require("mongodb");

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

const studios = [
  mk(1, [4, 2, 1], "North Light Cyc Wall", "Photo Studio", 55, 100, 12, "Gulshan, Dhaka", 4.9, ["Wi-Fi", "Lighting kit", "Parking", "Changing room"], "Tanvir Rahman", "tanvir@host.com", "A 20 ft white cyc wall with daylight windows and two strobe heads. Ideal for product, fashion and portrait shoots."),
  mk(2, [5, 3, 1], "Monsoon Podcast Lounge", "Podcast Lounge", 30, 50, 5, "Dhanmondi, Dhaka", 4.8, ["Wi-Fi", "Acoustic panels", "Kitchenette"], "Nusrat Jahan", "nusrat@host.com", "Four-mic setup with treated walls and a sofa corner, ready for interviews and video podcasts."),
  mk(3, [2, 4, 3], "Stage 9 Cinema Floor", "Film Stage", 120, 300, 40, "Uttara, Dhaka", 4.7, ["Green screen", "Lighting kit", "Parking", "Blackout curtains"], "Imran Hossain", "imran@host.com", "1,800 sq ft soundproofed stage with a drive-in door and a built-in grid for rigging lights."),
  mk(4, [1, 3, 5], "Padma Recording Suite", "Music Suite", 45, 120, 8, "Banani, Dhaka", 4.9, ["Acoustic panels", "Wi-Fi", "Kitchenette"], "Rafi Ahmed", "rafi@host.com", "Control room and live room with a vocal booth, 16-channel console and a grand piano."),
  mk(5, [4, 1, 2], "Clay and Canvas Workshop", "Workshop", 25, 40, 15, "Agrabad, Chattogram", 4.6, ["Wi-Fi", "Kitchenette", "Parking"], "Sadia Islam", "sadia@host.com", "Bright workshop with long tables, a kiln and wall space for painting and ceramics classes."),
  mk(6, [2, 5, 4], "Blue Hour Loft", "Photo Studio", 40, 80, 10, "Sylhet Sadar", 4.5, ["Wi-Fi", "Lighting kit", "Changing room"], "Mahin Chowdhury", "mahin@host.com", "Brick-wall loft with big windows, props and a small set kitchen for lifestyle shoots."),
  mk(7, [5, 2, 3], "Echo Room Voiceover Booth", "Podcast Lounge", 20, 30, 3, "Khulna Sadar", 4.4, ["Acoustic panels", "Wi-Fi"], "Farhan Kabir", "farhan@host.com", "Compact isolation booth for voiceover, dubbing and narration, with a large-diaphragm mic on hand."),
  mk(8, [3, 1, 5], "Riverside Band Room", "Music Suite", 35, 60, 7, "Barishal Sadar", 4.6, ["Parking", "Acoustic panels", "Wi-Fi"], "Demo Examiner", "examiner@studiospace.com", "Rehearsal room with a full backline, drum kit and PA, plus a river view lounge."),
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const col = client.db("studiospace").collection("studios");

    let added = 0;
    for (const s of studios) {
      const r = await col.updateOne(
        { title: s.title, ownerEmail: s.ownerEmail },
        { $setOnInsert: s },
        { upsert: true }
      );
      if (r.upsertedCount) added++;
    }
    console.log(`Added ${added} demo studios (${studios.length - added} already existed)`);
  } finally {
    await client.close();
  }
})();