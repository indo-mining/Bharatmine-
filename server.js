require("dotenv").config();
const express=require("express"),cors=require("cors"),crypto=require("crypto");
const {Pool}=require("pg");
const app=express(); app.use(cors()); app.use(express.json());
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const TASKS={community:25,updates:20,invite3:50,game1:100,level5:250,daily:10,mine:5};

function verify(initData){
  if(!initData||!process.env.TELEGRAM_BOT_TOKEN) throw Error("Missing Telegram configuration");
  const p=new URLSearchParams(initData), hash=p.get("hash"); p.delete("hash");
  const s=[...p.entries()].sort().map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=crypto.createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const expected=crypto.createHmac("sha256",secret).update(s).digest("hex");
  if(hash!==expected) throw Error("Invalid Telegram signature");
  if(Date.now()/1000-Number(p.get("auth_date"))>86400) throw Error("Expired Telegram data");
  return JSON.parse(p.get("user")||"{}");
}
async function auth(req){
  const u=verify(req.headers["x-telegram-init-data"]);
  if(!u.id) throw Error("Telegram user missing");
  await pool.query(`INSERT INTO users(telegram_id,username,first_name) VALUES($1,$2,$3)
    ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_seen_at=NOW()`,
    [u.id,u.username||null,u.first_name||null]);
  return u;
}
app.get("/health",(_,res)=>res.json({ok:true}));
app.get("/api/me",async(req,res)=>{try{const u=await auth(req);const r=await pool.query("SELECT * FROM users WHERE telegram_id=$1",[u.id]);res.json(r.rows[0])}catch(e){res.status(401).json({error:e.message})}});
app.post("/api/mining/start",async(req,res)=>{try{const u=await auth(req);await pool.query("UPDATE users SET mining_started_at=COALESCE(mining_started_at,NOW()) WHERE telegram_id=$1",[u.id]);res.json({ok:true})}catch(e){res.status(401).json({error:e.message})}});
app.post("/api/mining/stop",async(req,res)=>{try{const u=await auth(req);const c=await pool.connect();try{await c.query("BEGIN");const r=await c.query("SELECT balance,mining_started_at FROM users WHERE telegram_id=$1 FOR UPDATE",[u.id]);const x=r.rows[0];if(x?.mining_started_at){const sec=(Date.now()-new Date(x.mining_started_at))/1000;await c.query("UPDATE users SET balance=balance+$1,mining_started_at=NULL WHERE telegram_id=$2",[Math.max(0,sec)*0.25/3600,u.id])}await c.query("COMMIT")}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}res.json({ok:true})}catch(e){res.status(401).json({error:e.message})}});
app.post("/api/tasks/:id/claim",async(req,res)=>{try{const u=await auth(req),reward=TASKS[req.params.id];if(!reward)return res.status(404).json({error:"Unknown task"});const c=await pool.connect();try{await c.query("BEGIN");const old=await c.query("SELECT 1 FROM task_claims WHERE telegram_id=$1 AND task_id=$2",[u.id,req.params.id]);if(old.rowCount){await c.query("ROLLBACK");return res.status(409).json({error:"Already claimed"})}/* Verify the real task here before crediting. */await c.query("INSERT INTO task_claims VALUES($1,$2)",[u.id,req.params.id]);await c.query("UPDATE users SET balance=balance+$1 WHERE telegram_id=$2",[reward,u.id]);await c.query("COMMIT")}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}res.json({ok:true,reward})}catch(e){res.status(401).json({error:e.message})}});
app.get("/api/leaderboard",async(_,res)=>{try{res.json((await pool.query("SELECT username,first_name,balance FROM users ORDER BY balance DESC LIMIT 20")).rows)}catch(e){res.status(500).json({error:"Database error"})}});
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`BharatMine server running on port ${PORT}`);
});
