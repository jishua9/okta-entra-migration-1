export interface OktaApp {
  id: string;
  name: string;
  label: string;
  status: string;
  signOnMode: string;
  created: string;
  lastUpdated: string;
  settings?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  accessibility?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
  features?: string[];
  _links?: Record<string, unknown>;
}

export interface OktaAppGroup {
  id: string;
  profile?: { name?: string; description?: string };
}

export interface OktaAppUser {
  id: string;
  credentials?: { userName?: string };
  profile?: Record<string, unknown>;
  status?: string;
}

export interface OktaAppDetail {
  app: OktaApp;
  groups: OktaAppGroup[];
  users: OktaAppUser[];
}
