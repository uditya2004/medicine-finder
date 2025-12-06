<div align="center">

# 💊 Generic Medicine Finder

### AI-Powered Generic Medicine Finder for Indian Markets

![Node.js](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?logo=node.js) ![Express](https://img.shields.io/badge/Express-4.22.1-lightgrey?logo=express) ![AI](https://img.shields.io/badge/AI-Groq-orange) ![Google Gemini 2.5](https://img.shields.io/badge/Google_Gemini-2.5-blue) ![License](https://img.shields.io/badge/License-ISC-blue.svg)

[Features](#-key-features) • [Quick Start](#-getting-started) • [Usage](#-usage) • [Architecture](#-tech-stack) • [Contributing](#-contributing)

</div>

---

## 📋 Overview

An AI-powered web application that helps patients find cost-effective generic alternatives to branded medicines, with a focus on the Indian market.

### ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔍 **Smart Search** | Find generics using brand or generic names |
| 💰 **Price Comparison** | Real-time pricing with savings calculator |
| 🇮🇳 **Indian Market** | Jan Aushadhi, 1mg, Apollo integration |
| 🧪 **Ingredient Match** | Exact composition and dosage verification |
| ⚕️ **Safety Alerts** | Medical warnings and consultation reminders |

## 🚀 Getting Started

### Prerequisites

| Requirement | Details |
|-------------|----------|
| **Node.js** | v18.0.0 or higher |
| **API Keys** | • `GROQ_API_KEY`<br>• `GOOGLE_GENERATIVE_AI_API_KEY` |

### Installation

```bash
# Clone and install
git clone https://github.com/uditya2004/medicine-finder.git
cd medicine-finder
npm install

# Create .env file
echo "GROQ_API_KEY=your_key_here" > .env
echo "GOOGLE_GENERATIVE_AI_API_KEY=your_key_here" >> .env

# Start server
npm start
```

Open `http://localhost:3000` in your browser.

## 📖 Usage

### Web Interface
1. Open `http://localhost:3000`
2. Enter medicine name (e.g., "Crocin", "Paracetamol 500mg")
3. View instant comparison with pricing and savings

### Available Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start web server |
| `npm run medicine` | CLI mode for terminal |
| `npm run dev` | Development with auto-reload |

## 🏗️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | HTML5 • CSS3 • JavaScript |
| **Backend** | Express.js • AI SDK • OpenAI Agents |
| **AI Models** | Groq (GPT-OSS-120B) • Google Gemini |
| **APIs** | RxNorm (NIH) • Indian Pharmacy Pricing |

## 🔧 API Endpoints

| Method | Endpoint | Description | Example |
|--------|----------|-------------|----------|
| **POST** | `/api/search` | Find generic alternatives | `{"query": "Crocin 650mg"}` |
| **GET** | `/api/health` | Health check | Returns service status |

## 🤝 Contributing

Contributions welcome! Follow these steps:

1. 🍴 Fork the repository
2. 🌿 Create feature branch (`git checkout -b feature/NewFeature`)
3. 💾 Commit changes (`git commit -m 'Add NewFeature'`)
4. 📤 Push to branch (`git push origin feature/NewFeature`)
5. 🔀 Open Pull Request

## ⚠️ Disclaimer

> **⚕️ Medical Notice:**  
> Always consult a healthcare professional before changing medications.  
> This tool provides information only and is not a substitute for medical advice.

## 📄 License

ISC License

---

<div align="center">

**Made with ❤️ for affordable healthcare**

[⭐ Star this repo](https://github.com/uditya2004/medicine-finder) if you find it helpful!

</div>
