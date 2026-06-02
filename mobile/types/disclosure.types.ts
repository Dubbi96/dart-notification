export interface Disclosure {
  rcpNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  rcpDt: string;
  flrName: string;
  rmk: string;
  disclosureType: string;
  createdAt: string;
  dartUrl?: string;
}

export interface DisclosureType {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}
