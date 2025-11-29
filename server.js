import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { main } from "./med_tool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Serve the main HTML page
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

// API endpoint to search for generic medicines
app.post("/api/search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    console.log(`\n📥 Received query: "${query}"`);

    // Call the medicine agent
    const result = await main(query);

    console.log(`📤 Sending response for: "${query}"`);

    res.json({ success: true, result });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process your request. Please try again.",
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Generic Medicine Finder API is running" });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏥 Generic Medicine Finder Server                       ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   Open the URL in your browser to use the app!            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
