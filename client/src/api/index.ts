import api, { getErrorMessage } from "./request";

export { getErrorMessage };

// 默认导出底层请求实例（即 request.ts 的默认导出 cachedApi）。
// 心跳等场景需要显式绕过本地缓存层真实打网络（传 cache:false），故直接复用此实例。
export default api;

export const authApi = {
  login: (data: { username: string; password: string }) => api.post("/auth/login", data),
  getProfile: () => api.get("/auth/me"),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    api.post("/auth/change-password", data),
};

export const usersApi = {
  list: (params?: { page?: number; pageSize?: number; competitionId?: number | string }) => {
    const query: Record<string, unknown> = {
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 20,
    };
    if (params?.competitionId !== undefined) query.competitionId = params.competitionId;
    return api.get("/users", { params: query });
  },
  get: (id: number) => api.get(`/users/${id}`),
  create: (data: any) => api.post("/users", data),
  update: (id: number, data: any) => api.patch(`/users/${id}`, data),
  updatePassword: (id: number, data: { password: string }) =>
    api.patch(`/users/${id}/password`, data),
  remove: (id: number) => api.delete(`/users/${id}`),
};

export const materialsApi = {
  list: (page = 1, pageSize = 50) => api.get("/materials", { params: { page, pageSize } }),
  get: (id: number) => api.get(`/materials/${id}`),
  create: (data: any) => api.post("/materials", data),
  update: (id: number, data: any) => api.patch(`/materials/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/materials/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/materials/${id}/impact`, { cache: false }),
};

export const partsApi = {
  list: (page = 1, pageSize = 50) => api.get("/parts", { params: { page, pageSize } }),
  get: (id: number) => api.get(`/parts/${id}`),
  create: (data: any) => api.post("/parts", data),
  update: (id: number, data: any) => api.patch(`/parts/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/parts/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/parts/${id}/impact`, { cache: false }),
};

export const productsApi = {
  list: (page = 1, pageSize = 50) => api.get("/products", { params: { page, pageSize } }),
  get: (id: number) => api.get(`/products/${id}`),
  create: (data: any) => api.post("/products", data),
  update: (id: number, data: any) => api.patch(`/products/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/products/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/products/${id}/impact`, { cache: false }),
};

export const mapsApi = {
  full: (params?: any) => api.get("/maps/full", { params }),
  nodes: {
    list: (page = 1, pageSize = 100, competitionId?: number) => {
      const params: any = { page, pageSize };
      if (competitionId != null) params.competitionId = competitionId;
      return api.get("/map-nodes", { params });
    },
    create: (data: any) => api.post("/map-nodes", data),
    update: (id: number, data: any) => api.patch(`/map-nodes/${id}`, data),
    remove: (id: number, competitionId?: number | null) =>
      api.delete(`/map-nodes/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
    impact: (id: number) => api.get(`/map-nodes/${id}/impact`, { cache: false }),
  },
  edges: {
    list: (page = 1, pageSize = 200, competitionId?: number) => {
      const params: any = { page, pageSize };
      if (competitionId != null) params.competitionId = competitionId;
      return api.get("/map-edges", { params });
    },
    create: (data: any) => api.post("/map-edges", data),
    update: (id: number, data: any) => api.patch(`/map-edges/${id}`, data),
    remove: (id: number, competitionId?: number | null) =>
      api.delete(`/map-edges/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
    impact: (id: number) => api.get(`/map-edges/${id}/impact`, { cache: false }),
  },
  nodeTypes: {
    list: (competitionId?: number) => {
      const params: any = {};
      if (competitionId != null) params.competitionId = competitionId;
      return api.get("/map-node-types", { params });
    },
    create: (data: any) => api.post("/map-node-types", data),
    update: (id: number, data: any) => api.patch(`/map-node-types/${id}`, data),
    remove: (id: number, competitionId?: number | null) =>
      api.delete(`/map-node-types/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
    impact: (id: number) => api.get(`/map-node-types/${id}/impact`, { cache: false }),
  },
  pathTypes: {
    list: (competitionId?: number) => {
      const params: any = {};
      if (competitionId != null) params.competitionId = competitionId;
      return api.get("/path-types", { params });
    },
    create: (data: any) => api.post("/path-types", data),
    update: (id: number, data: any) => api.patch(`/path-types/${id}`, data),
    remove: (id: number, competitionId?: number | null) =>
      api.delete(`/path-types/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
    impact: (id: number) => api.get(`/path-types/${id}/impact`, { cache: false }),
  },
};

export const infrastructuresApi = {
  list: (params?: any) => api.get("/infrastructures", { params: params || {} }),
  get: (id: number) => api.get(`/infrastructures/${id}`),
  create: (data: any) => api.post("/infrastructures", data),
  update: (id: number, data: any) => api.patch(`/infrastructures/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/infrastructures/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/infrastructures/${id}/impact`, { cache: false }),
};

export const fuelsApi = {
  list: (params?: any) => api.get("/fuels", { params: params || {} }),
  get: (id: number) => api.get(`/fuels/${id}`),
  create: (data: any) => api.post("/fuels", data),
  update: (id: number, data: any) => api.patch(`/fuels/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/fuels/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/fuels/${id}/impact`, { cache: false }),
};

export const industryTypesApi = {
  list: () => api.get("/industry-types"),
  get: (id: number) => api.get(`/industry-types/${id}`),
  create: (data: any) => api.post("/industry-types", data),
  update: (id: number, data: any) => api.patch(`/industry-types/${id}`, data),
  remove: (id: number) => api.delete(`/industry-types/${id}`),
  listFields: (id: number) => api.get(`/industry-types/${id}/fields`),
  createField: (id: number, data: any) => api.post(`/industry-types/${id}/fields`, data),
  updateField: (fieldId: number, data: any) => api.patch(`/industry-types/fields/${fieldId}`, data),
  removeField: (fieldId: number) => api.delete(`/industry-types/fields/${fieldId}`),
};

export const companyFieldsApi = {
  // 读取某公司产业字段当前值
  get: (companyId: number, opts?: { includeHidden?: boolean }) =>
    api.get(
      `/company-fields/${companyId}`,
      opts?.includeHidden ? { params: { includeHidden: true } } : undefined,
    ),
  // 批量写入某公司产业字段值
  set: (companyId: number, data: any) => api.put(`/company-fields/${companyId}`, data),
};

export const contractTypesApi = {
  list: (enabledOnly = false) => api.get("/contract-types", { params: { enabledOnly } }),
  get: (id: number) => api.get(`/contract-types/${id}`),
  create: (data: any) => api.post("/contract-types", data),
  update: (id: number, data: any) => api.patch(`/contract-types/${id}`, data),
  remove: (id: number) => api.delete(`/contract-types/${id}`),
};

export const contractsApi = {
  list: (params?: { competitionId?: number; status?: string; page?: number; pageSize?: number }) =>
    api.get("/contracts", { params: params || {} }),
  get: (id: number) => api.get(`/contracts/${id}`),
  create: (data: any) => api.post("/contracts", data),
  execute: (id: number, data?: any) => api.post(`/contracts/${id}/execute`, data || {}),
  // 分步补全合同编号：传入 { [role]: 编号 }，仅更新指定参与方
  updatePartyNumbers: (id: number, partyNumbers: Record<string, string>) =>
    api.patch(`/contracts/${id}/party-numbers`, { partyNumbers }),
  precheck: (id: number) => api.post(`/contracts/${id}/precheck`),
  setStatus: (id: number, status: string) => api.patch(`/contracts/${id}/status`, { status }),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/contracts/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/contracts/${id}/impact`, { cache: false }),
};

export const companiesApi = {
  // 列出公司（可按比赛 / 区域过滤）。权限编辑器中用于选择「合同审核范围」；区域管理用于按区域枚举公司。
  list: (params?: { competitionId?: number; regionId?: number }) =>
    api.get("/companies", { params: params || {} }),
  get: (id: number) => api.get(`/companies/${id}`),
  update: (id: number, data: any) => api.patch(`/companies/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/companies/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  impact: (id: number) => api.get(`/companies/${id}/impact`, { cache: false }),
};

export const regionsApi = {
  create: (data: any) => api.post("/regions", data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(`/regions/${id}`, competitionId != null ? { params: { competitionId } } : undefined),
  // 地图区域总览：区域来自地图节点去重，返回 [{ region, companies, cards }]（读，绕过集合缓存）
  mapOverview: (competitionId?: number) =>
    api.get("/regions/map-overview", {
      params: competitionId != null ? { competitionId } : {},
      cache: false,
    }),
  // 按区域名保存总览卡片配置（find-or-create，覆盖写）
  saveOverviewCardsByName: (name: string, cards: any[], competitionId?: number) =>
    api.put(
      `/regions/by-name/${encodeURIComponent(name)}/overview-cards`,
      { cards },
      { params: competitionId != null ? { competitionId } : {} },
    ),
};

export const consumerDemandsApi = {
  // 列出某比赛的消费者需求（可选按区域过滤）
  list: (competitionId?: number, region?: string) => {
    const params: Record<string, unknown> = {};
    if (competitionId != null) params.competitionId = competitionId;
    if (region != null) params.region = region;
    return api.get("/consumer-demands", { params, cache: false });
  },
  create: (data: { competitionId?: number; region: string; productId: number; quantity?: number; note?: string }) =>
    api.post("/consumer-demands", data),
  update: (id: number, data: { region?: string; productType?: string; quantity?: number; note?: string }) =>
    api.patch(`/consumer-demands/${id}`, data),
  remove: (id: number, competitionId?: number | null) =>
    api.delete(
      `/consumer-demands/${id}`,
      competitionId != null ? { params: { competitionId } } : undefined,
    ),
};
