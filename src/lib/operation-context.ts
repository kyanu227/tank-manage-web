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

export type OperationContext = {
  actor: OperationActor;
  customer?: CustomerSnapshot;
};
