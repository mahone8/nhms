/** Converts an array of flat objects into a CSV string (header row + data). */
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    if (val == null) return "";
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    const str = String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

/** Sends `rows` as either JSON or a downloadable CSV, based on req.query.format. */
function sendReport(req, res, rows, filename) {
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(Array.isArray(rows) ? rows : [rows]));
  }
  res.json(rows);
}

module.exports = { toCsv, sendReport };
