const bcrypt = require("bcryptjs");
const db = require("./database");

const BRANCHES = ["Nazzal", "Nooroxotel", "Ayesha", "Aqsa", "Velvet Rose"];
const BEDS_PER_BRANCH = 36;

const FEMALE_NAMES = [
  "Ayesha Malik", "Fatima Raza", "Zainab Tariq", "Mehak Iqbal", "Sana Farooq",
  "Areeba Khan", "Hira Shahid", "Komal Nasir", "Iqra Basit", "Amna Yousaf",
  "Rimsha Aslam", "Laiba Hassan", "Noor Fatima", "Maryam Siddiqui", "Sadia Anwar",
  "Rabia Sultan", "Alishba Rauf", "Warda Zahid", "Anum Riaz", "Sundas Bashir",
  "Mahnoor Latif", "Aqsa Naveed", "Kiran Javed", "Nimra Saeed", "Shazia Karim",
  "Farah Deeba", "Bushra Yasin", "Tania Waseem", "Hafsa Idrees", "Zara Munir",
];

function pad(n) { return String(n).padStart(2, "0"); }
function monthKeyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function monthLabelOf(d) { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }

function alreadySeeded() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM branches").get();
  return row.c > 0;
}

function seed() {
  if (alreadySeeded()) {
    console.log("Database already has data — skipping seed. Delete db/hostel.db to reseed from scratch.");
    return;
  }

  const insertBranch = db.prepare("INSERT INTO branches (name) VALUES (?)");
  const insertBed = db.prepare("INSERT INTO beds (branch_id, bed_number, resident_id) VALUES (?, ?, NULL)");
  const insertResident = db.prepare(
    "INSERT INTO residents (name, phone, cnic, branch_id, bed_id, monthly_fee, join_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const setBedResident = db.prepare("UPDATE beds SET resident_id = ? WHERE id = ?");
  const insertPayment = db.prepare(
    "INSERT INTO payments (resident_id, month_key, month_label, amount, status, paid_date) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertAdmin = db.prepare("INSERT INTO admin_accounts (name, username, password_hash) VALUES (?, ?, ?)");
  const insertResidentAccount = db.prepare(
    "INSERT INTO resident_accounts (username, password_hash, resident_id) VALUES (?, ?, ?)"
  );

  const now = new Date();
  let nameIdx = 0;

  const runAll = db.exec.bind(db);
  runAll("BEGIN");
  try {
    BRANCHES.forEach((branchName, bIdx) => {
      const branchId = Number(insertBranch.run(branchName).lastInsertRowid);
      const bedIdByNumber = {};
      for (let n = 1; n <= BEDS_PER_BRANCH; n++) {
        const bedId = Number(insertBed.run(branchId, n).lastInsertRowid);
        bedIdByNumber[n] = bedId;
      }

      const fee = 25000 + bIdx * 1500;
      const occupiedCount = 22 + (bIdx % 3);
      const allBedNumbers = Array.from({ length: BEDS_PER_BRANCH }, (_, i) => i + 1);
      // simple seeded shuffle so results are reproducible but well distributed
      let seed = bIdx * 104729 + 7;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = allBedNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [allBedNumbers[i], allBedNumbers[j]] = [allBedNumbers[j], allBedNumbers[i]];
      }
      const occupiedSlots = allBedNumbers.slice(0, occupiedCount);

      occupiedSlots.forEach((bedNum, i) => {
        const name = FEMALE_NAMES[nameIdx % FEMALE_NAMES.length];
        nameIdx++;
        const phone = `03${(i % 5) + 1}${bIdx}-${1000000 + ((i * 37 + bIdx * 91) % 8999999)}`;
        const joinMonthOffset = 1 + (i % 10);
        const joinDate = new Date(now.getFullYear(), now.getMonth() - joinMonthOffset, 5 + (i % 20));

        const residentId = Number(
          insertResident.run(name, phone, "", branchId, bedIdByNumber[bedNum], fee, joinDate.toISOString().slice(0, 10))
            .lastInsertRowid
        );
        setBedResident.run(residentId, bedIdByNumber[bedNum]);

        for (let m = 2; m >= 1; m--) {
          const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
          insertPayment.run(
            residentId, monthKeyOf(d), monthLabelOf(d), fee, "paid",
            new Date(d.getFullYear(), d.getMonth(), 3).toISOString().slice(0, 10)
          );
        }
        const roll = (i + bIdx) % 5;
        const currentStatus = roll === 0 ? "overdue" : roll === 1 ? "pending" : "paid";
        insertPayment.run(
          residentId, monthKeyOf(now), monthLabelOf(now), fee, currentStatus,
          currentStatus === "paid" ? now.toISOString().slice(0, 10) : null
        );

        if (i === 0) {
          const username = name.split(" ")[0].toLowerCase() + bedNum;
          insertResidentAccount.run(username, bcrypt.hashSync("resident123", 10), residentId);
        }
      });
    });

    insertAdmin.run("Front Desk Admin", "admin", bcrypt.hashSync("admin123", 10));

    runAll("COMMIT");
    console.log("Seed complete: 5 branches x 36 beds, sample residents, payments, and demo accounts created.");
    console.log("Admin login: admin / admin123");
    console.log("Resident login example: ayesha1 / resident123 (Nazzal branch, bed 1)");
  } catch (err) {
    runAll("ROLLBACK");
    throw err;
  }
}

if (require.main === module) {
  seed();
}

module.exports = seed;
