export interface OutputOptions {
    json: boolean;
}

export interface GlobalOptions extends OutputOptions {
    provider: string;
    baseUrl?: string;
    streamBaseUrl?: string;
    network: string;
    rpcUrl?: string;
    privateKey?: string;
    address?: string;
    manager?: string;
    tradeCap?: string;
}

export interface StreamTradesOptions {
    kind: string;
    reconnect: boolean;
    reconnectDelayMs: string;
}

export interface OrderbookOptions {
    depth: string;
    watch?: boolean;
    intervalMs: string;
}

export interface SpotOrderOptions {
    manager?: string;
    quantity: string;
    price?: string;
    clientOrderId?: string;
    expiration?: string;
    orderType: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface SpotLimitOptions {
    manager?: string;
    cancel?: string;
    side?: string;
    price?: string;
    quantity?: string;
    clientOrderId?: string;
    expiration?: string;
    orderType: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface MarginLimitOptions {
    marginManager?: string;
    side: string;
    price: string;
    quantity: string;
    leverage: string;
    clientOrderId?: string;
    expiration?: string;
    orderType: string;
    selfMatch: string;
    payWithDeep: boolean;
    reduceOnly: boolean;
    dryRun: boolean;
}

export interface MarginSpotOptions {
    marginManager?: string;
    side: string;
    quantity: string;
    leverage: string;
    clientOrderId?: string;
    selfMatch: string;
    payWithDeep: boolean;
    reduceOnly: boolean;
    dryRun: boolean;
}

export interface MarginDepositOptions {
    marginManager?: string;
    coin: string;
    amount: string;
    dryRun: boolean;
}

export interface MarginPositionOptions {
    marginManager?: string;
}

export interface MarginPoolsOptions {
    registered?: boolean;
}

export interface MarginCloseOptions {
    marginManager?: string;
    side?: string;
    quantity?: string;
    full: boolean;
    repay: boolean;
    withdraw: boolean;
    reduceOnly?: boolean;
    nonReduceOnly?: boolean;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface TradeSwapOptions {
    amount: string;
    minOut: string;
    deepAmount: string;
    dryRun: boolean;
}

export interface ManagerTxOptions {
    manager?: string;
    coin: string;
    amount: string;
    recipient?: string;
    dryRun: boolean;
}

export interface AccountBalanceOptions {
    coin?: string;
}

export interface RunTwapOptions {
    manager?: string;
    slices?: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface RunDcaOptions {
    manager?: string;
    orders: string;
    priceLimit?: string;
    maxRuntime: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface RunGridOptions {
    manager?: string;
    upper: string;
    lower: string;
    grids: string;
    size: string;
    side: string;
    interval: string;
    maxRuntime: string;
    trailingStop?: string;
    orderType: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface RunTrailingStopOptions {
    marginManager?: string;
    trail: string;
    interval: string;
    activation?: string;
    repay: boolean;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}

export interface RunCrossPoolSpreadOptions {
    marginManagerA?: string;
    marginManagerB?: string;
    sizeA: string;
    sizeB: string;
    entry: string;
    close: string;
    stopLoss?: string;
    interval: string;
    maxRuntime: string;
    leverage: string;
    selfMatch: string;
    payWithDeep: boolean;
    dryRun: boolean;
}