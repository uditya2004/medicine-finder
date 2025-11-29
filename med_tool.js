import { Agent, run, tool, setTracingDisabled, setDefaultOpenAIClient } from "@openai/agents";
import { google } from "@ai-sdk/google";
import { aisdk } from "@openai/agents-extensions";
import { generateText } from "ai";
import "dotenv/config";
import { z } from "zod";
import axios from "axios";

// Disable OpenAI tracing to suppress the warning message
setTracingDisabled(true);

import OpenAI from "openai";

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

setDefaultOpenAIClient(groqClient);

// Groq model for main agent
const GROQ_MODEL = "openai/gpt-oss-120b";

// Create a Gemini model instance with Google Search grounding capability (used only for grounding)
const geminiModel = google("gemini-2.5-flash");

const systemPrompt = `You are a helpful assistant that helps Indian patients find affordable generic medicines.

Your goal is to help poor people save money by finding generic alternatives to expensive branded medicines.

CRITICAL: You MUST return your response in a STRUCTURED JSON FORMAT for the UI to display properly.

WORKFLOW - Follow this order:
1. FIRST: Use find_generic_with_prices tool - it combines fast API lookup with Indian price search
2. The tool returns structured data that gets displayed in a comparison table

IMPORTANT GUIDELINES:
1. Always identify the ACTIVE INGREDIENT (salt) and EXACT DOSAGE
2. Find generic alternatives with the SAME salt and SAME dosage
3. Warn users to NEVER change dosage without consulting a doctor
4. Focus on Indian market - Jan Aushadhi, 1mg, Apollo prices

YOUR RESPONSE FORMAT - Return a JSON object with this structure:
{
  "comparison": {
    "branded": {
      "name": "Brand name",
      "salt": "Active ingredient",
      "dosage": "500mg",
      "price": "₹XX per tablet",
      "pricePerStrip": "₹XX for 10 tablets"
    },
    "generic": {
      "name": "Generic name",
      "salt": "Same active ingredient",
      "dosage": "500mg", 
      "price": "₹XX per tablet",
      "pricePerStrip": "₹XX for 10 tablets",
      "savings": "XX%"
    }
  },
  "alternatives": [
    {"name": "Alternative 1", "salt": "...", "price": "₹XX", "source": "1mg/Apollo"},
    {"name": "Alternative 2", "salt": "...", "price": "₹XX", "source": "..."},
    ...up to 5 alternatives
  ],
  "description": "Detailed explanation text here..."
}

If you cannot find structured data, still provide the description field with helpful information.`;

// Tool 1: Search for medicine and get its RxCUI (identifier)
const searchMedicine = tool({
  name: "search_medicine",
  description: "Search for a medicine by name (brand or generic) to get its identifier and basic information",
  parameters: z.object({
    medicineName: z.string().describe("Name of the medicine (can be brand name like 'Tylenol' or generic like 'Paracetamol')"),
  }),
  execute: async function ({ medicineName }) {
    console.log("🔍 Searching for medicine:", medicineName);
    
    try {
      // First try to find the drug
      const searchUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(medicineName)}`;
      const response = await axios.get(searchUrl);
      
      if (!response.data.drugGroup?.conceptGroup) {
        return JSON.stringify({
          success: false,
          message: `Could not find medicine "${medicineName}". Please check the spelling or try the generic name.`,
          suggestion: "Common generic names: Paracetamol=Acetaminophen, Ibuprofen, Aspirin, Metformin, Omeprazole"
        });
      }

      const results = [];
      for (const group of response.data.drugGroup.conceptGroup) {
        if (group.conceptProperties) {
          for (const drug of group.conceptProperties) {
            results.push({
              rxcui: drug.rxcui,
              name: drug.name,
              type: group.tty,
              typeDescription: getTypeDescription(group.tty)
            });
          }
        }
      }

      return JSON.stringify({
        success: true,
        searchTerm: medicineName,
        results: results.slice(0, 10), // Limit to 10 results
        totalFound: results.length
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
});

// Tool 2: Get detailed information including brand vs generic alternatives
const getMedicineDetails = tool({
  name: "get_medicine_details",
  description: "Get detailed information about a specific medicine using its RxCUI, including generic and brand alternatives",
  parameters: z.object({
    rxcui: z.string().describe("The RxCUI identifier of the medicine"),
  }),
  execute: async function ({ rxcui }) {
    console.log("📋 Getting details for RxCUI:", rxcui);
    
    try {
      const detailsUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`;
      const response = await axios.get(detailsUrl);
      
      if (!response.data.allRelatedGroup?.conceptGroup) {
        return JSON.stringify({
          success: false,
          message: "Could not find detailed information for this medicine."
        });
      }

      const result = {
        rxcui: rxcui,
        ingredient: null,
        genericDrug: null,
        brandNames: [],
        brandedDrugs: [],
        dosageForm: null
      };

      for (const group of response.data.allRelatedGroup.conceptGroup) {
        if (!group.conceptProperties) continue;
        
        switch (group.tty) {
          case 'IN': // Ingredient (active salt)
            result.ingredient = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui
            }));
            break;
          case 'SCD': // Semantic Clinical Drug (Generic)
            result.genericDrug = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui,
              type: 'GENERIC'
            }));
            break;
          case 'BN': // Brand Names
            result.brandNames = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui
            }));
            break;
          case 'SBD': // Semantic Branded Drug
            result.brandedDrugs = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui,
              type: 'BRANDED'
            }));
            break;
          case 'DF': // Dose Form
            result.dosageForm = group.conceptProperties.map(p => p.name);
            break;
        }
      }

      return JSON.stringify({
        success: true,
        data: result,
        recommendation: "The GENERIC option (SCD type) has the same active ingredient and dosage as branded versions but typically costs much less."
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
});

// Tool 3: Find generic equivalent for a specific branded medicine
const findGenericEquivalent = tool({
  name: "find_generic_equivalent",
  description: "Find the generic equivalent of a branded medicine - this is the main tool for cost savings",
  parameters: z.object({
    brandName: z.string().describe("The brand name of the medicine (e.g., 'Tylenol 500mg')"),
  }),
  execute: async function ({ brandName }) {
    console.log("💊 Finding generic equivalent for:", brandName);
    
    try {
      // Step 1: Search for the medicine
      const searchUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(brandName)}`;
      const searchResponse = await axios.get(searchUrl);
      
      if (!searchResponse.data.drugGroup?.conceptGroup) {
        return JSON.stringify({
          success: false,
          message: `Could not find "${brandName}". Try searching with just the medicine name without dosage.`
        });
      }

      // Find an SCD (generic) or SBD (branded) entry to get rxcui
      let targetRxcui = null;
      let targetName = null;
      
      for (const group of searchResponse.data.drugGroup.conceptGroup) {
        if (group.conceptProperties && (group.tty === 'SCD' || group.tty === 'SBD')) {
          targetRxcui = group.conceptProperties[0].rxcui;
          targetName = group.conceptProperties[0].name;
          break;
        }
      }

      if (!targetRxcui) {
        return JSON.stringify({
          success: false,
          message: "Could not identify a specific drug formulation. Please provide more details like dosage."
        });
      }

      // Step 2: Get all related drugs
      const relatedUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${targetRxcui}/allrelated.json`;
      const relatedResponse = await axios.get(relatedUrl);
      
      const result = {
        searchedFor: brandName,
        identifiedAs: targetName,
        activeIngredient: null,
        genericVersion: null,
        brandedVersions: [],
        recommendation: null
      };

      if (relatedResponse.data.allRelatedGroup?.conceptGroup) {
        for (const group of relatedResponse.data.allRelatedGroup.conceptGroup) {
          if (!group.conceptProperties) continue;
          
          if (group.tty === 'IN') {
            result.activeIngredient = group.conceptProperties.map(p => p.name).join(', ');
          }
          if (group.tty === 'SCD') {
            result.genericVersion = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui
            }));
          }
          if (group.tty === 'SBD') {
            result.brandedVersions = group.conceptProperties.map(p => ({
              name: p.name,
              rxcui: p.rxcui
            }));
          }
        }
      }

      // Generate recommendation
      if (result.genericVersion && result.genericVersion.length > 0) {
        result.recommendation = {
          buyThis: result.genericVersion[0].name,
          activeIngredient: result.activeIngredient,
          avoidTheseBrands: result.brandedVersions.map(b => b.name.split('[')[1]?.replace(']', '') || b.name),
          savingsMessage: "Generic medicines contain the EXACT SAME active ingredient in the EXACT SAME dosage as branded medicines. They are equally safe and effective but cost much less!"
        };
      }

      return JSON.stringify({
        success: true,
        data: result
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
});

// Tool 4: Get all available dosages for an ingredient
const getAvailableDosages = tool({
  name: "get_available_dosages",
  description: "Get all available dosages and forms of a medicine ingredient",
  parameters: z.object({
    ingredientName: z.string().describe("The generic ingredient name (e.g., 'acetaminophen', 'ibuprofen')"),
  }),
  execute: async function ({ ingredientName }) {
    console.log("📊 Getting available dosages for:", ingredientName);
    
    try {
      const searchUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(ingredientName)}`;
      const response = await axios.get(searchUrl);
      
      if (!response.data.drugGroup?.conceptGroup) {
        return JSON.stringify({
          success: false,
          message: `Could not find dosages for "${ingredientName}".`
        });
      }

      const genericDosages = [];
      
      for (const group of response.data.drugGroup.conceptGroup) {
        if (group.tty === 'SCD' && group.conceptProperties) { // Only generic formulations
          for (const drug of group.conceptProperties) {
            // Filter for single-ingredient formulations (no combinations)
            if (!drug.name.includes(' / ')) {
              genericDosages.push({
                name: drug.name,
                rxcui: drug.rxcui
              });
            }
          }
        }
      }

      return JSON.stringify({
        success: true,
        ingredient: ingredientName,
        availableGenericFormulations: genericDosages,
        note: "These are pure generic formulations without combination drugs. Ask your doctor which dosage is right for you."
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
});

// Helper function to describe drug types
function getTypeDescription(tty) {
  const descriptions = {
    'SCD': 'Generic Drug (Recommended - Same quality, lower cost)',
    'SBD': 'Branded Drug (More expensive)',
    'BN': 'Brand Name',
    'IN': 'Active Ingredient',
    'MIN': 'Multiple Ingredients',
    'DF': 'Dosage Form',
    'SCDC': 'Generic Drug Component',
    'SBDC': 'Branded Drug Component'
  };
  return descriptions[tty] || tty;
}

// MAIN TOOL: Combined fast API + Indian price search
const findGenericWithPrices = tool({
  name: "find_generic_with_prices",
  description: "PRIMARY TOOL - Find generic alternatives with Indian prices. Combines fast RxNav API lookup with Google Search for Indian market prices from 1mg, Apollo, Jan Aushadhi. Use this tool FIRST for any medicine query.",
  parameters: z.object({
    medicineName: z.string().describe("Name of the medicine (brand or generic) with dosage if known"),
  }),
  execute: async function ({ medicineName }) {
    console.log("🔍 [FAST] Searching RxNav API for:", medicineName);
    
    const result = {
      query: medicineName,
      apiData: null,
      indianPrices: null,
      error: null
    };

    // STEP 1: Fast RxNav API lookup (usually <500ms)
    try {
      const searchUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(medicineName)}`;
      const searchResponse = await axios.get(searchUrl, { timeout: 5000 });
      
      if (searchResponse.data.drugGroup?.conceptGroup) {
        let genericDrug = null;
        let brandedDrug = null;
        let ingredient = null;

        for (const group of searchResponse.data.drugGroup.conceptGroup) {
          if (!group.conceptProperties) continue;
          
          if (group.tty === 'SCD' && !genericDrug) {
            genericDrug = group.conceptProperties[0];
          }
          if (group.tty === 'SBD' && !brandedDrug) {
            brandedDrug = group.conceptProperties[0];
          }
          if (group.tty === 'IN' && !ingredient) {
            ingredient = group.conceptProperties[0];
          }
        }

        // If we found a drug, get related info
        if (genericDrug || brandedDrug) {
          const targetRxcui = (genericDrug || brandedDrug).rxcui;
          const relatedUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${targetRxcui}/allrelated.json`;
          const relatedResponse = await axios.get(relatedUrl, { timeout: 5000 });
          
          if (relatedResponse.data.allRelatedGroup?.conceptGroup) {
            const apiResult = {
              genericName: null,
              brandNames: [],
              activeIngredient: null,
              dosageForm: null
            };

            for (const group of relatedResponse.data.allRelatedGroup.conceptGroup) {
              if (!group.conceptProperties) continue;
              
              if (group.tty === 'IN') {
                apiResult.activeIngredient = group.conceptProperties[0].name;
              }
              if (group.tty === 'SCD') {
                apiResult.genericName = group.conceptProperties[0].name;
              }
              if (group.tty === 'BN') {
                apiResult.brandNames = group.conceptProperties.slice(0, 5).map(p => p.name);
              }
              if (group.tty === 'DF') {
                apiResult.dosageForm = group.conceptProperties[0].name;
              }
            }
            result.apiData = apiResult;
          }
        }
      }
      console.log("✅ [FAST] RxNav API completed");
    } catch (apiError) {
      console.log("⚠️ RxNav API error (continuing with web search):", apiError.message);
    }

    // STEP 2: Google Search for Indian prices (parallel-friendly)
    console.log("🇮🇳 [SEARCH] Getting Indian prices via Google Search...");
    try {
      const saltName = result.apiData?.activeIngredient || medicineName;
      const searchPrompt = `Find current medicine prices in India for "${medicineName}" (salt: ${saltName}):

IMPORTANT: Return factual price data. Search for:
1. Branded medicine price from 1mg.com or Apollo Pharmacy
2. Generic alternatives with prices
3. At least 5 alternative generic brands with prices

For EACH medicine, provide:
- Name
- Price in INR (₹)
- Source (1mg, Apollo, Jan Aushadhi, etc.)

Format the prices clearly in INR (₹). Include per-tablet and per-strip prices where available. Do NOT include purchase links or how to buy information.`;

      const { text, providerMetadata } = await generateText({
        model: geminiModel,
        tools: {
          google_search: google.tools.googleSearch({}),
        },
        prompt: searchPrompt,
      });

      const metadata = providerMetadata?.google;
      const groundingMetadata = metadata?.groundingMetadata;
      
      let sources = [];
      if (groundingMetadata?.groundingChunks) {
        sources = groundingMetadata.groundingChunks
          .filter(chunk => chunk.web)
          .slice(0, 5)
          .map(chunk => ({
            title: chunk.web.title,
            url: chunk.web.uri
          }));
      }

      result.indianPrices = {
        data: text,
        sources: sources,
        searchQueries: groundingMetadata?.webSearchQueries || []
      };
      console.log("✅ [SEARCH] Indian prices retrieved");
    } catch (searchError) {
      console.log("⚠️ Google Search error:", searchError.message);
      result.indianPrices = { error: searchError.message };
    }

    return JSON.stringify({
      success: true,
      medicine: medicineName,
      apiData: result.apiData,
      indianPrices: result.indianPrices,
      tip: "Jan Aushadhi Kendras offer the cheapest generic medicines. Find stores at janaushadhi.gov.in or call 1800-180-8080"
    });
  },
});

// Tool 5: Web Search using Google Grounding - for real-time medicine info, prices, and availability
const webSearchMedicine = tool({
  name: "web_search_medicine",
  description: "Search the web for real-time information about medicine prices, availability, generic alternatives in India, and latest medical information. Use this for current pricing, where to buy, and region-specific medicine information.",
  parameters: z.object({
    searchQuery: z.string().describe("The search query about medicine (e.g., 'generic paracetamol 500mg price India', 'where to buy cheap ibuprofen')"),
  }),
  execute: async function ({ searchQuery }) {
    console.log("🌐 Web Search (Google Grounding):", searchQuery);
    
    try {
      const { text, sources, providerMetadata } = await generateText({
        model: geminiModel,
        tools: {
          google_search: google.tools.googleSearch({}),
        },
        prompt: `Search for: ${searchQuery}
        
Please provide accurate, up-to-date information about:
1. Medicine prices (if asked)
2. Comparison between generic and branded prices
3. Any relevant warnings or information

Focus on helping people find affordable medicine options. Do NOT include purchase links or how to buy information.`,
      });

      // Extract grounding metadata for sources
      const metadata = providerMetadata?.google;
      const groundingMetadata = metadata?.groundingMetadata;
      
      // Format sources if available
      let sourcesInfo = [];
      if (groundingMetadata?.groundingChunks) {
        sourcesInfo = groundingMetadata.groundingChunks
          .filter(chunk => chunk.web)
          .map(chunk => ({
            title: chunk.web.title,
            url: chunk.web.uri
          }));
      }

      return JSON.stringify({
        success: true,
        searchQuery: searchQuery,
        result: text,
        sources: sourcesInfo,
        searchQueries: groundingMetadata?.webSearchQueries || []
      });
    } catch (error) {
      console.error("Web search error:", error);
      return JSON.stringify({
        success: false,
        error: error.message,
        suggestion: "Try rephrasing your search query or check your internet connection."
      });
    }
  },
});

// Tool 6: Search for medicine information specific to India (using Google Grounding)
const searchIndiaMedicine = tool({
  name: "search_india_medicine",
  description: "Search for medicine information specific to India - prices, generic alternatives available in India, Jan Aushadhi stores, and Indian pharmacy options. Always includes price information.",
  parameters: z.object({
    medicineName: z.string().describe("Name of the medicine to search for in India"),
  }),
  execute: async function ({ medicineName }) {
    console.log("🇮🇳 Searching India medicine info:", medicineName);
    
    try {
      const searchPrompt = `Search for information about "${medicineName}" medicine in India:

1. What is the generic name and salt composition?
2. What is the approximate price range for generic vs branded versions in India?
3. Is it available at Jan Aushadhi Kendras (government generic medicine stores)?
4. What are the popular generic brands available in India?
5. Any important information patients should know?

Focus on helping Indian patients find affordable generic alternatives. Include specific Indian brand names and prices in INR if available.`;

      const { text, sources, providerMetadata } = await generateText({
        model: geminiModel,
        tools: {
          google_search: google.tools.googleSearch({}),
        },
        prompt: searchPrompt,
      });

      const metadata = providerMetadata?.google;
      const groundingMetadata = metadata?.groundingMetadata;
      
      let sourcesInfo = [];
      if (groundingMetadata?.groundingChunks) {
        sourcesInfo = groundingMetadata.groundingChunks
          .filter(chunk => chunk.web)
          .slice(0, 5)
          .map(chunk => ({
            title: chunk.web.title,
            url: chunk.web.uri
          }));
      }

      return JSON.stringify({
        success: true,
        medicine: medicineName,
        country: "India",
        result: text,
        sources: sourcesInfo,
        tip: "Visit your nearest Jan Aushadhi Kendra for the cheapest generic medicines. Find stores at: janaushadhi.gov.in"
      });
    } catch (error) {
      console.error("India medicine search error:", error);
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
});

// Create the Agent with combined tool as primary
// Uses Groq model for all agent reasoning
const agent = new Agent({
  name: "Generic Medicine Finder",
  model: GROQ_MODEL,
  instructions: systemPrompt,
  tools: [
    findGenericWithPrices,  // PRIMARY: Combined fast API + Indian prices
    searchMedicine,         // Backup: RxNav search only
    getMedicineDetails,     // Backup: Get details by RxCUI
    findGenericEquivalent,  // Backup: Find generic equivalent
    getAvailableDosages,    // Backup: Get dosage forms
    webSearchMedicine,      // Backup: General web search
    searchIndiaMedicine     // Backup: India-specific search
  ],
});

// Main function
async function main(query = "") {
  if (!query) {
    console.log("Please provide a medicine name to search.");
    return;
  }
  
  console.log("\n🏥 Generic Medicine Finder");
  console.log("━".repeat(50));
  console.log(`Query: ${query}`);
  console.log("━".repeat(50) + "\n");
  
  const result = await run(agent, query);
  
  console.log("\n" + "━".repeat(50));
  console.log("📋 RECOMMENDATION:");
  console.log("━".repeat(50));
  console.log(result.finalOutput);
  
  return result.finalOutput;
}

// Export for use as a module
export { main, agent };

// CLI: Allow running from command line with arguments
// Only run if this file is executed directly, not when imported
const isMainModule = process.argv[1]?.includes('med_tool.js');
if (isMainModule) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // Join all arguments as a single query
    main(args.join(" "));
  } else {
    // Default test query
    main("Doctor prescribed Lipitor 20mg for cholesterol. What's the generic?");
  }
}