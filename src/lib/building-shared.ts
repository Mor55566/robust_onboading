export const ALL_BUILDINGS_ID = "all";

export function isAllBuildingsId(value: string | null | undefined): boolean {
  return value === ALL_BUILDINGS_ID;
}

export type BuildingOption = {
  id: string;
  name: string;
};

export type ComplexBuildingSummary = {
  id: string;
  name: string;
  address: string | null;
  complex_id: string | null;
  sort_order: number;
  floors_count: number;
  locations_count: number;
  equipment_count: number;
};
