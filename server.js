const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/create-payment", async (req, res) => {
    try {
        res.json({
            url: "https://example.com"
        });
    } catch (err) {
        res.status(500).json({
            error: "Payment creation failed"
        });
    }
});

app.get("/verify-payment", async (req, res) => {
    res.json({
        valid: true,
        paid: true
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});