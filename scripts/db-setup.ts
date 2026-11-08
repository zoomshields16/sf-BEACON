// npm run db:setup — rebuild the local database: schema → functions → seed, then put the team's real demo
// phones in place from DEMO_PHONES (.env, never committed). Re-runnable; wipes demo activity.
import "dotenv/config";
import { execFileSync } from "node:child_process";

const db = process.env.DATABASE_URL || "safenet";
const psql = (args: string[], input?: string) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", db, ...args],
               { input, stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });

if (!process.env.DATABASE_URL) {
  try { execFileSync("createdb", ["safenet"], { stdio: "ignore" }); } catch { /* already exists */ }
}
psql(["-f", "db/schema.sql", "-f", "db/functions.sql", "-f", "db/seed.sql"]);

// DEMO_PHONES = "+1AAA,+1BBB" → demo people SF-0490001, SF-0490002 (in that order).
const phones = (process.env.DEMO_PHONES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
phones.slice(0, 2).forEach((phone, i) => {
  if (!/^\+\d{10,15}$/.test(phone)) throw new Error(`DEMO_PHONES entry "${phone}" must look like +12145550123`);
  // psql variables (:'phone') are only interpolated in script input, not -c — and they're quoted safely.
  psql(["-v", `phone=${phone}`, "-v", `policy=SF-049000${i + 1}`, "-f", "-"],
       "update policyholders set phone = :'phone' where policy_number = :'policy';");
});
console.log(`DB ready${phones.length ? ` — ${phones.length} real demo phone(s) set from DEMO_PHONES` : " — no DEMO_PHONES set (demo people keep 555 placeholders)"}`);
