/**
 * tanks コレクションのドキュメント共通型。
 * 各画面で独自に定義していた TankDoc を最大公約数で統一したもの。
 * id / status は必須、それ以外はオプショナル。
 */
export interface TankDoc {
  id: string;
  status: string;
  location?: string;
  staff?: string;
  type?: string;
  note?: string;
  logNote?: string;
  updatedAt?: any;
  /** 次回耐圧検査期限（旧GAS互換で "YYYY/MM/DD" 文字列。Timestamp/Date も可） */
  nextMaintenanceDate?: any;
}
