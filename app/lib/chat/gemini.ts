import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Content,
  type Part,
  type FunctionDeclarationSchema,
} from "@google/generative-ai";
import { tools, type ToolName, type Tool } from "./tools";
import { executeTool } from "./execute-tool";

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
);

// System prompt for the chatbot
const SYSTEM_PROMPT = `You are AsBuilt IQ Assistant, an AI helper for the CAD/DXF OCR application called AsBuilt IQ (also known as Strand Line and Equipment Identifier).

## Your Capabilities:
1. **File Queries**: Count and list uploaded DXF/PDF files in the system
2. **Result Queries**: Access OCR results (strand meter values), poles, equipment shapes, and cable spans from the current scan
3. **Calculations**: Sum strand meters, count entities, provide summaries
4. **Actions**: Export data to Excel files

## Equipment Shape Mappings (from DXF):
- Circle → 2-Way Tap / Splitter
- Square → 4-Way Tap
- Hexagon → 8-Way Tap
- Rectangle → Node or Amplifier (depends on layer name)
- Triangle → Line Extender

## Pole Detection Sources:
- "text" → Direct TEXT entity from DXF file
- "mtext" → Multi-line text block from DXF
- "stroke" → OCR-detected from strokes using TrOCR (may need review if confidence < 0.5)

## OCR Results:
- Each detected digit represents a strand meter count
- Values with confidence < 0.8 or unusual readings are flagged for review
- Users can correct values manually

## Response Formatting Guidelines:
Format all responses using markdown with emojis for visual appeal:

### Emojis to Use:
- 📁 Files and folders
- 📊 Statistics and summaries
- 📍 Poles and locations
- ⚡ Equipment (taps, amplifiers, etc.)
- 🔗 Cable spans
- ✅ Success / completed
- ⚠️ Needs review / warning
- ❌ Error / failed
- 🔍 Scanning / processing
- 📤 Export

### Formatting Rules:
1. **Use section headers** with emojis (e.g., "📁 **Files Summary**")
2. **Use bullet points** for listing items
3. **Bold important numbers** and key information
4. **Include contextual status** when relevant (e.g., scan status when showing results)
5. **Keep responses scannable** - use short lines and clear structure
6. **Group related information** under clear headers

### Example Response Format:
\`\`\`
📁 **Files Summary**
• **Total:** 33 files uploaded

📂 **By Folder:**
• SKY: 7 files
• Root: 26 files

📊 **Status:** Ready to scan
\`\`\`

## Guidelines:
- Always use tools to get real data - NEVER guess or make up numbers
- When reporting counts, always mention how many items need review if any
- Be concise but helpful in your responses
- If no file is loaded or no scan has been run, inform the user appropriately
- For export actions, confirm success and mention the exported file
- If a tool returns an error, explain it to the user in simple terms`;

// Convert a single tool parameter to Gemini schema format
function convertParameterToSchema(param: {
  type: string;
  description: string;
  enum?: string[];
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    description: param.description,
  };

  if (param.enum && param.enum.length > 0) {
    // Enum string type
    base.type = SchemaType.STRING;
    base.format = "enum";
    base.enum = param.enum;
  } else if (param.type === "boolean") {
    base.type = SchemaType.BOOLEAN;
  } else if (param.type === "number") {
    base.type = SchemaType.NUMBER;
  } else {
    base.type = SchemaType.STRING;
  }

  return base;
}

// Convert our tool definitions to Gemini format
function getGeminiFunctionDeclarations(): FunctionDeclaration[] {
  return tools.map((tool: Tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    Object.entries(tool.parameters).forEach(([key, param]) => {
      properties[key] = convertParameterToSchema(param);
      if (!param.optional) {
        required.push(key);
      }
    });

    const declaration: FunctionDeclaration = {
      name: tool.name,
      description: tool.description,
    };

    // Only add parameters if there are any
    if (Object.keys(properties).length > 0) {
      declaration.parameters = {
        type: SchemaType.OBJECT,
        properties,
        required,
      } as FunctionDeclarationSchema;
    }

    return declaration;
  });
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface GeminiResponse {
  response: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
}

export async function chat(
  messages: ChatMessage[],
  userMessage: string,
): Promise<GeminiResponse> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: getGeminiFunctionDeclarations() }],
  });

  // Convert our message format to Gemini format
  const history: Content[] = messages.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  // Start chat with history
  const chatSession = model.startChat({ history });

  // Send the user message
  let result = await chatSession.sendMessage(userMessage);
  let response = result.response;

  const toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }> = [];

  // Handle function calls in a loop
  while (response.functionCalls() && response.functionCalls()!.length > 0) {
    const functionCalls = response.functionCalls()!;

    // Execute all function calls
    const functionResponses: Part[] = [];

    for (const call of functionCalls) {
      const toolName = call.name as ToolName;
      const args = (call.args || {}) as Record<string, unknown>;

      // Execute the tool
      const toolResult = await executeTool(toolName, args);

      toolCalls.push({
        name: toolName,
        args,
        result: toolResult,
      });

      functionResponses.push({
        functionResponse: {
          name: toolName,
          response: { result: toolResult },
        },
      });
    }

    // Send function results back to the model
    result = await chatSession.sendMessage(functionResponses);
    response = result.response;
  }

  return {
    response: response.text(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
