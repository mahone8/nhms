const path = require("path");
const express = require("express");
const session = require("express-session");

require("./db/seed")(); // creates tables (via db/database.js) and seeds demo data on first run

const authRoutes = require("./routes/auth");
const branchRoutes = require("./routes/branches");
const residentRoutes = require("./routes/residents");
const paymentRoutes = require("./routes/payments");
const menuRoutes = require("./routes/menu");
const accountRoutes = require("./routes/accounts");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "hostel-management-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }, // 8 hour session
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/residents", residentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/accounts", accountRoutes);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Hostel Management System running at http://localhost:${PORT}`);
});
