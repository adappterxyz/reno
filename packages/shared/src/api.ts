/** Standard API envelope used by the backend. */
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: string;
  code?: string;
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export const API_BASE_PATH = "/api";

/** Route constants shared by client and server to avoid string drift. */
export const routes = {
  health: `${API_BASE_PATH}/health`,
  login: `${API_BASE_PATH}/auth/login`,
  me: `${API_BASE_PATH}/auth/me`,
  projects: `${API_BASE_PATH}/projects`,
  project: (id: string) => `${API_BASE_PATH}/projects/${id}`,
  splatModels: (projectSpaceId: string) =>
    `${API_BASE_PATH}/project-spaces/${projectSpaceId}/splat-models`,
  splatModel: (id: string) => `${API_BASE_PATH}/splat-models/${id}`,
  splatModelFileUrl: (id: string) => `${API_BASE_PATH}/splat-models/${id}/file-url`,
  uploadCreate: (id: string) => `${API_BASE_PATH}/splat-models/${id}/upload/create`,
  uploadPart: (id: string) => `${API_BASE_PATH}/splat-models/${id}/upload/part`,
  uploadComplete: (id: string) => `${API_BASE_PATH}/splat-models/${id}/upload/complete`,
  calibrate: (id: string) => `${API_BASE_PATH}/splat-models/${id}/calibrate`,
  tickets: (splatModelId: string) => `${API_BASE_PATH}/splat-models/${splatModelId}/tickets`,
  ticket: (id: string) => `${API_BASE_PATH}/tickets/${id}`,
  measurements: (splatModelId: string) =>
    `${API_BASE_PATH}/splat-models/${splatModelId}/measurements`,
  measurement: (id: string) => `${API_BASE_PATH}/measurements/${id}`,
} as const;
