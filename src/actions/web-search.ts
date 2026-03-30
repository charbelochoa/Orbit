import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

// ─── DuckDuckGo Instant Answer (no API key required) ─────────────────────────
async function ddgSearch(query: string): Promise<SearchResult[]> {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url, {
            headers: { "User-Agent": "Orbit-AI/1.0" },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const data = await res.json() as any;

        const results: SearchResult[] = [];

        // Instant answer
        if (data.AbstractText) {
            results.push({
                title: data.Heading || query,
                url: data.AbstractURL || "",
                snippet: data.AbstractText
            });
        }

        // Related topics
        const topics = (data.RelatedTopics || []) as any[];
        for (const t of topics.slice(0, 4)) {
            if (t.Text && t.FirstURL) {
                results.push({ title: t.Text.split(" - ")[0] || t.Text.slice(0, 60), url: t.FirstURL, snippet: t.Text });
            }
        }

        return results;
    } catch {
        return [];
    }
}

// ─── Gemini Grounding Search (fallback — uses Google Search grounding) ────────
async function geminiSearch(query: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "";

    try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: `Busca y responde: ${query}` }] }],
            config: {
                tools: [{ googleSearch: {} }],
            } as any
        });
        return response.text || "";
    } catch (e: any) {
        console.warn("[Web Search] Grounding failed:", e.message);
        return "";
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function webSearch(parameters: any): Promise<string> {
    const query: string = parameters?.query || parameters?.q || "";
    const mode: string  = (parameters?.mode || "search").toLowerCase();

    if (!query) return "Necesito una consulta para buscar.";
    console.log(`[Web Search] 🔍 "${query}" (modo: ${mode})`);

    // 1. Try Gemini grounding first (most accurate, returns summarized answer)
    const grounded = await geminiSearch(query);
    if (grounded && grounded.length > 50) {
        console.log(`[Web Search] ✅ Grounding OK (${grounded.length} chars)`);
        return grounded.slice(0, 2000);
    }

    // 2. Fallback to DuckDuckGo
    const results = await ddgSearch(query);
    if (results.length === 0) {
        return `No encontré resultados para: "${query}". Intenta reformular la búsqueda.`;
    }

    const lines = results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`);
    return `Resultados para "${query}":\n\n${lines.join("\n\n")}`;
}

// ─── Weather using wttr.in (free, no API key) ─────────────────────────────────
export async function weatherReport(parameters: any): Promise<string> {
    const city: string = parameters?.city || "Madrid";
    console.log(`[Weather] ☁️ Consultando clima en ${city}...`);
    try {
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=3`;
        const res = await fetch(url, {
            headers: { "User-Agent": "curl/7.68.0" },
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = (await res.text()).trim();
        return text || `No encontré el clima para ${city}.`;
    } catch (e: any) {
        // Fallback: Gemini knows general weather context
        return `No pude obtener el clima en tiempo real para ${city}. Error: ${e.message}`;
    }
}
