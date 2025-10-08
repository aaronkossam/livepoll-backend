// server.js
const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcrypt");

// ==== ENVIRONMENT CONFIG ====
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/poll-app";
const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://livepoll-six.vercel.app";

// ==== EXPRESS + HTTP + SOCKET.IO ====
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

// ==== MIDDLEWARE ====
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ==== DATABASE CONNECTION ====
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ==== MODELS ====
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" },
});
const User = mongoose.model("User", userSchema);

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  counts: [{ type: Number, default: 0 }],
  totalVotes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const Poll = mongoose.model("Poll", pollSchema);

// ==== ROUTES ====

// --- Root route ---
app.get("/", (req, res) => {
  res.send("✅ LivePoll Backend Running Successfully!");
});

// --- Auth: Register ---
app.post("/api/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "All fields are required" });

    if (!/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({ error: "Invalid email format" });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(400).json({ error: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ email: email.toLowerCase(), password: hashed });
    await newUser.save();

    res.json({ message: "Registration successful, please login." });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Auth: Login ---
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "All fields are required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    const redirect = user.role === "admin" ? "/Admin/Dashboard" : "/Dashboard";

    res.json({ success: true, role: user.role, redirect });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Get All Polls ---
app.get("/api/polls", async (req, res) => {
  try {
    const polls = await Poll.find().sort({ createdAt: -1 });
    res.json(polls);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// --- Create Poll ---
app.post("/api/polls", async (req, res) => {
  const { question, options } = req.body;
  if (!question || !options || options.length < 2) {
    return res
      .status(400)
      .json({ error: "Question and at least 2 options required" });
  }

  try {
    const poll = new Poll({
      question,
      options,
      counts: new Array(options.length).fill(0),
    });
    const savedPoll = await poll.save();
    io.emit("pollCreated", savedPoll);
    res.status(201).json(savedPoll);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// --- Vote on Poll ---
app.post("/api/polls/:id/vote", async (req, res) => {
  const { optionIndex } = req.body;
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll || optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({ error: "Invalid poll or option" });
    }
    poll.counts[optionIndex] += 1;
    poll.totalVotes += 1;
    await poll.save();

    io.emit("voteUpdate", poll);
    res.json(poll);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ==== SOCKET.IO ====
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);
  socket.on("disconnect", () =>
    console.log("🔴 Client disconnected:", socket.id)
  );
});

// ==== START SERVER ====
server.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);
