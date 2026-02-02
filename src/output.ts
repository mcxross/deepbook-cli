export interface OutputOptions {
  json: boolean;
}

export function printResult(value: unknown, options: OutputOptions): void {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (typeof value === "string") {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

export function printStreamEvent(
  eventName: string,
  payload: unknown,
  options: OutputOptions,
  pool: string,
): void {
  const timestamp = new Date().toISOString();

  if (options.json) {
    console.log(
      JSON.stringify({
        timestamp,
        pool,
        event: eventName,
        data: payload,
      }),
    );
    return;
  }

  console.log(`[${timestamp}] ${pool} ${eventName}`);
  console.log(JSON.stringify(payload, null, 2));
  console.log("");
}
