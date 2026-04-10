import Groq from 'groq-sdk';

const SYSTEM_PROMPT =
  'You are the LCARS computer of a Federation starship. Speak with calm authority ' +
  'and precision. Reference Starfleet records, stardates, and Federation knowledge. ' +
  'Keep responses concise.';

const MODEL = 'llama-3.1-8b-instant';

const client = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY as string,
  dangerouslyAllowBrowser: true,
});

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function useGroqStream() {
  async function streamCompletion(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      stream: true,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) onChunk(delta);
    }
  }

  return { streamCompletion };
}
