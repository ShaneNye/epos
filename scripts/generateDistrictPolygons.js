const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const turf = require("@turf/turf");

// CHANGE TO YOUR REAL FILE NAME IF DIFFERENT
const INPUT_CSV = path.join(__dirname, "../public/geo/postcodes/raw/NSPL.csv");


const OUTPUT_DIR = path.join(__dirname, "../public/geo/postcodes");

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log("📍 Reading NSPL CSV...");

/* ============================================================
   SOUTH OF ENGLAND POSTCODE AREAS
   ============================================================ */
const SOUTH_AREAS = new Set([
    "BN","BH","BR","CR","CT",
    "DA","DT",
    "E","EC",
    "GU",
    "HA","HP","KT",
    "ME","MK",
    "N",
    "OX","PO","RG","RH","RM",
    "SE","SM","SO","SW",
    "TN","TW","WD"
]);

// Dictionary: { "BN2": [ [lon, lat], ... ] }
const districts = {};

fs.createReadStream(INPUT_CSV)
    .pipe(csv({ separator: "," }))
    .on("data", (row) => {
        try {
            const postcode = row.pcds?.replace(/"/g, "").trim();
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.long);

            if (!postcode || isNaN(lat) || isNaN(lon)) return;

            // Outward district: "BN2", "RG12", etc.
            const district = postcode.split(" ")[0].trim().toUpperCase();
            if (!district) return;

            // Postcode area: letters only ("BN","RG","CT")
            const area = district.replace(/[0-9].*/, "");

            // 🎯 Only keep South-of-England postcode areas
            if (!SOUTH_AREAS.has(area)) return;

            if (!districts[district]) districts[district] = [];
            districts[district].push([lon, lat]);

        } catch (err) {
            console.log("Skipping row:", err.message);
        }
    })
    .on("end", async () => {
        const keys = Object.keys(districts);
        console.log(`📦 CSV parsed. South districts found: ${keys.length}`);

        for (const district of keys) {
            const points = districts[district];
            if (points.length < 3) continue;

            const pts = turf.points(points);
            let hull = null;

            try {
                hull = turf.concave(pts, { maxEdge: 3 });
            } catch (err) {
                console.log(`⚠️ Concave hull failed for ${district}, using convex.`);
                hull = turf.convex(pts);
            }

            if (!hull) {
                console.log(`⚠️ Could not generate hull for ${district}`);
                continue;
            }

            const out = {
                type: "FeatureCollection",
                features: [hull]
            };

            const outFile = path.join(OUTPUT_DIR, `${district}.geojson`);
            fs.writeFileSync(outFile, JSON.stringify(out));

            console.log(`✔ Saved ${district}.geojson`);
        }

        console.log("🎉 South of England polygons generated!");
    });
