import { WsProvider } from "@polkadot/api";
import chalk from "chalk";
import { ApiPromise } from "@polkadot/api";
import { typesBundle } from "../../moonbeam-types-bundle/dist";
import { listenBlocks, printBlockDetails } from "./monitoring";
import { Options } from "yargs";

export type NETWORK_NAME = "stagenet" | "alphanet" | "moonsama" | "moonsilver" | "moonriver";

export const NETWORK_WS_URLS: { [name in NETWORK_NAME]: string } = {
  stagenet: "wss://wss.stagenet.moonbeam.gcp.purestake.run",
  alphanet: "wss://wss.testnet.moonbeam.network",
  moonsama: "wss://wss.moonsama.gcp.purestake.run",
  moonsilver: "wss://wss.moonsilver.moonbeam.network",
  moonriver: "wss://wss.moonriver.moonbeam.network",
};
export const NETWORK_NAMES = Object.keys(NETWORK_WS_URLS) as NETWORK_NAME[];

export const NETWORK_COLORS: { [name in NETWORK_NAME]: chalk.ChalkFunction } = {
  stagenet: chalk.blueBright,
  alphanet: chalk.greenBright,
  moonsama: chalk.magentaBright,
  moonsilver: chalk.yellowBright,
  moonriver: chalk.redBright,
};

export type NetworkOptions = {
  url: Options & { type: "string" };
  network: Options & { type: "string" };
};

export const NETWORK_YARGS_OPTIONS: NetworkOptions = {
  url: {
    type: "string",
    description: "Websocket url",
    conflicts: ["network"],
    string: true,
  },
  network: {
    type: "string",
    choices: NETWORK_NAMES,
    description: "Known network",
    string: true,
  },
};

export function isKnownNetwork(name: string): name is NETWORK_NAME {
  return NETWORK_NAMES.includes(name as NETWORK_NAME);
}

export const getWsProviderForNetwork = (name: NETWORK_NAME) => {
  return new WsProvider(NETWORK_WS_URLS[name]);
};

// Supports providing an URL or a known network
export const getWsProviderFor = (name_or_url: NETWORK_NAME | string) => {
  if (isKnownNetwork(name_or_url)) {
    return getWsProviderForNetwork(name_or_url);
  }
  return new WsProvider(name_or_url);
};

export const getApiFor = async (name_or_url: NETWORK_NAME | string) => {
  const wsProvider = getWsProviderFor(name_or_url);
  return await ApiPromise.create({
    provider: wsProvider,
    typesBundle: typesBundle,
  });
};

export const getMonitoredApiFor = async (name_or_url: NETWORK_NAME | string) => {
  const wsProvider = getWsProviderFor(name_or_url);
  const api = await ApiPromise.create({
    provider: wsProvider,
    typesBundle: typesBundle,
  });
  listenBlocks(api, async (blockDetails) => {
    printBlockDetails(blockDetails, {
      prefix: isKnownNetwork(name_or_url)
        ? NETWORK_COLORS[name_or_url](name_or_url.padStart(10, " "))
        : undefined,
    });
  });
  return api;
};

export async function monitorNetwork(name_or_url: NETWORK_NAME | string) {}

type NetworkArgv = {
  url?: string;
  network?: string;
};