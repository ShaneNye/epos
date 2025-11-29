const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const turf = require("@turf/turf");

// CHANGE TO YOUR REAL FILE NAME IF DIFFERENT
const INPUT_CSV = path.join(__dirname, "../public/geo/raw/NSPL.csv");

const OUTPUT_DIR = path.join(__dirname, "../public/geo/postcodes");

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log("📍 Reading NSPL CSV...");

// Dictionary: { "BN2": [ [lon, lat], ... ] }
const districts = {};

fs.createReadStream(INPUT_CSV)
    .pipe(csv({ separator: "," })) // <-- CORRECT FOR YOUR FILE
    .on("data", (row) => {
        try {
            // KEY FIELDS (from your sample)
            const postcode = row.pcds?.replace(/"/g, "").trim(); // remove quotes
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.long);

            if (!postcode || isNaN(lat) || isNaN(lon)) return;

            // District prefix = characters before the space
            const district = postcode.split(" ")[0].trim().toUpperCase();

            if (!district) return;

            if (!districts[district]) districts[district] = [];

            districts[district].push([lon, lat]);

        } catch (err) {
            console.log("Skipping row:", err.message);
        }
    })
    .on("end", async () => {
        console.log(`📦 CSV parsed successfully. Districts found: ${Object.keys(districts).length}`);

        for (const district of Object.keys(districts)) {
            const points = districts[district];
            if (points.length < 3) continue;

            const pts = turf.points(points);

            let hull = null;

            try {
                // concave hull gives a realistic shape
                hull = turf.concave(pts, { maxEdge: 3 });
            } catch (err) {
                console.log(`⚠️ Concave hull failed for ${district}, using convex.`);
                hull = turf.convex(pts);
            }

            if (!hull) {
                console.log(`⚠️ Could not generate hull for ${district}`);
                continue;
            }

            // Wrap in a FeatureCollection
            const out = {
                type: "FeatureCollection",
                features: [hull]
            };

            const outFile = path.join(OUTPUT_DIR, `${district}.geojson`);
            fs.writeFileSync(outFile, JSON.stringify(out));

            console.log(`✔ Saved ${district}.geojson`);
        }

        console.log("🎉 All polygons generated!");
    });
