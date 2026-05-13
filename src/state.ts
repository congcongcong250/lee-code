export interface AppState {
  provider: string;
  model: string;
  customBaseUrl: string;
  apiKey: string;
}

let state: AppState = {
  provider: "openrouter",
  model: "qwen/qwen3-next-80b-a3b-instruct:free",
  customBaseUrl: "",
  apiKey: "",
};

export function getState() {
  return state;
}

export function setProvider(p: string) {
  state.provider = p;
}

export function setModel(m: string) {
  state.model = m;
}

export function setCustomBaseUrl(url: string) {
  state.customBaseUrl = url;
}

export function setApiKey(key: string) {
  state.apiKey = key;
}

export default state;