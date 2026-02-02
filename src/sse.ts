export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

export interface ConnectSSEOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
}

function parseEventBlock(block: string): SSEEvent | null {
  const lines = block.split("\n");
  let eventName = "message";
  let id: string | undefined;
  const dataParts: string[] = [];

  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith(":")) {
      continue;
    }

    const separator = rawLine.indexOf(":");
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
    const rawValue = separator === -1 ? "" : rawLine.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataParts.push(value);
    } else if (field === "id") {
      id = value;
    }
  }

  if (dataParts.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataParts.join("\n"),
    id,
  };
}

export async function connectSSE(options: ConnectSSEOptions): Promise<void> {
  const response = await fetch(options.url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      ...options.headers,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const suffix = body ? `: ${body}` : "";
    throw new Error(`SSE connection failed (${response.status} ${response.statusText})${suffix}`);
  }

  if (!response.body) {
    throw new Error("SSE response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        const parsed = parseEventBlock(rawEvent);
        if (parsed) {
          options.onEvent(parsed);
        }

        boundaryIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
