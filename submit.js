// Netlify Function: form data ko Supabase me save karta hai.
// Netlify ke Environment Variables se SUPABASE_URL aur key padhta hai.

const BUCKET = "admissions";
const MAX_PHOTO = 1 * 1024 * 1024;
const MAX_PDF = 2 * 1024 * 1024;

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const REQUIRED = [
  "student_name", "father_name", "mother_name", "dob", "gender", "phone",
  "address", "previous_school", "board", "roll_no", "passing_year",
  "percentage", "applied_class",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const KEY = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    ""
  ).trim();

  if (!SUPABASE_URL || !KEY) {
    return json(500, {
      error: "Server setup adhura hai: Netlify me SUPABASE_URL aur SUPABASE_ANON_KEY environment variable add karke dobara deploy karein.",
    });
  }

  // Naye "sb_..." keys ko sirf apikey header me bhejte hain, purani JWT keys dono me.
  const authHeaders = { apikey: KEY };
  if (!KEY.startsWith("sb_")) authHeaders.Authorization = `Bearer ${KEY}`;

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Galat data bheja gaya." });
  }

  const f = payload.fields || {};
  for (const k of REQUIRED) {
    if (f[k] === undefined || String(f[k]).trim() === "") {
      return json(400, { error: `Field khali hai: ${k}` });
    }
  }
  if (!/^[6-9][0-9]{9}$/.test(String(f.phone))) {
    return json(400, { error: "Mobile number sahi 10 digit ka dalein." });
  }
  const pct = Number(f.percentage);
  if (!(pct >= 0 && pct <= 100)) return json(400, { error: "Percentage 0 se 100 ke beech ho." });

  const photoB64 = payload.photo && payload.photo.data;
  const pdfB64 = payload.marksheet && payload.marksheet.data;
  if (!photoB64 || !pdfB64) return json(400, { error: "Photo aur marksheet dono zaruri hain." });

  const photoBuf = Buffer.from(photoB64, "base64");
  const pdfBuf = Buffer.from(pdfB64, "base64");

  if (photoBuf.length > MAX_PHOTO) return json(400, { error: "Photo 1 MB se kam honi chahiye." });
  if (pdfBuf.length > MAX_PDF) return json(400, { error: "Marksheet 2 MB se kam honi chahiye." });

  // File ke asli type ki jaanch (sirf naam par bharosa nahi)
  const isPng = photoBuf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isPdf = pdfBuf.slice(0, 4).toString() === "%PDF";
  if (!isPng) return json(400, { error: "Photo asli PNG file honi chahiye." });
  if (!isPdf) return json(400, { error: "Marksheet asli PDF file honi chahiye." });

  const id = require("crypto").randomUUID();
  const photoPath = `photos/${id}.png`;
  const pdfPath = `marksheets/${id}.pdf`;

  async function upload(path, buf, type) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": type, "x-upsert": "false" },
      body: buf,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`File upload fail (${res.status}): ${t}`);
    }
  }

  try {
    await upload(photoPath, photoBuf, "image/png");
    await upload(pdfPath, pdfBuf, "application/pdf");

    const row = {
      student_name: String(f.student_name).trim(),
      father_name: String(f.father_name).trim(),
      mother_name: String(f.mother_name).trim(),
      dob: f.dob,
      gender: f.gender,
      phone: String(f.phone),
      email: f.email ? String(f.email).trim() : null,
      address: String(f.address).trim(),
      previous_school: String(f.previous_school).trim(),
      board: f.board,
      roll_no: String(f.roll_no).trim(),
      passing_year: Number(f.passing_year),
      percentage: pct,
      applied_class: f.applied_class,
      photo_path: photoPath,
      marksheet_path: pdfPath,
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/admissions`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Data save fail (${res.status}): ${t}`);
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
