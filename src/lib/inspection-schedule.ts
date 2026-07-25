export type CalculateInspectionScheduleInput = {
  validityYears: number;
  nextInspectionDateBase: Date;
  inspectionDate: Date;
};

export type InspectionSchedule = {
  maintenanceDate: string;
  nextMaintenanceDate: string;
};

export function calculateInspectionSchedule(
  input: CalculateInspectionScheduleInput,
): InspectionSchedule {
  const nextInspectionDate = new Date(input.nextInspectionDateBase.getTime());
  nextInspectionDate.setFullYear(
    nextInspectionDate.getFullYear() + input.validityYears,
  );

  return {
    maintenanceDate: formatDateYMD(input.inspectionDate),
    nextMaintenanceDate: formatDateYMD(nextInspectionDate),
  };
}

/** Date を "YYYY/MM/DD" 形式に整形（Firestore 保存用） */
function formatDateYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
