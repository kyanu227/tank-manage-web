export type OperationActor = {
  staffId: string;
  staffName: string;
  staffEmail?: string;
  role?: string;
  rank?: string;
};

export type CustomerSnapshot = {
  customerId: string;
  customerName: string;
};

export type OperationSource =
  | "manual"
  | "order_fulfillment"
  | "return_tag_processing"
  | "bulk_return"
  | "portal"
  | "procurement"
  | "dashboard_correction"
  | "system";

export type OperationWorkflow =
  | "tank_operation"
  | "order"
  | "return"
  | "uncharged_report"
  | "procurement"
  | "supply_order"
  | "dashboard_edit"
  | "dashboard_void";

export type ReturnCondition = "normal" | "unused" | "uncharged" | "keep";

export type OperationContext = {
  actor: OperationActor;
  customer?: CustomerSnapshot;
  transactionId?: string;
  source?: OperationSource;
  workflow?: OperationWorkflow;
  returnCondition?: ReturnCondition;
};
