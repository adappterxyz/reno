import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { routes, type SplatModel, type Ticket, type Measurement } from "@reno/shared";
import { api } from "./client.js";

export interface Project {
  id: string;
  name: string;
  location: string | null;
  status: string;
}
export interface ProjectSpace {
  id: string;
  project_id: string;
  name: string;
  status: string;
  splat_model_id: string | null;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<{ id: string; role: string; email?: string }>(routes.me) });
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>(routes.projects) });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; location?: string }) => api.post<Project>(routes.projects, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<{ project: Project; spaces: ProjectSpace[] }>(routes.project(id)),
    enabled: !!id,
  });
}

export function useCreateSpace(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => api.post<ProjectSpace>(`${routes.project(projectId)}/spaces`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });
}

export function useSplatModels(spaceId: string) {
  return useQuery({
    queryKey: ["splat-models", spaceId],
    queryFn: () => api.get<SplatModel[]>(routes.splatModels(spaceId)),
    enabled: !!spaceId,
  });
}

export function useSplatModel(id: string) {
  return useQuery({
    queryKey: ["splat-model", id],
    queryFn: () => api.get<SplatModel>(routes.splatModel(id)),
    enabled: !!id,
  });
}

export function useTickets(splatModelId: string) {
  return useQuery({
    queryKey: ["tickets", splatModelId],
    queryFn: () => api.get<Ticket[]>(routes.tickets(splatModelId)),
    enabled: !!splatModelId,
  });
}

export function useMeasurements(splatModelId: string) {
  return useQuery({
    queryKey: ["measurements", splatModelId],
    queryFn: () => api.get<Measurement[]>(routes.measurements(splatModelId)),
    enabled: !!splatModelId,
  });
}
