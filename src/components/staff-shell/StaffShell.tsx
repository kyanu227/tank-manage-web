"use client";

import type { StaffShellProps } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

/**
 * staff 画面の外殻。
 *
 * viewport policy（docs/design §5）を1つの data 属性から導出する:
 *   locked  => 画面内で完結し、shell が下端 safe-area を所有する
 *   allowed => document scroll。shell は下端を予約せず、背景を画面下端まで続ける
 *
 * 上部 safe-area は header の padding-top に統合してあるため、
 * ここに独立した spacer は置かない（面が2つに割れないことを構造で保証する）。
 *
 * header 直下の 10px fade がこの shell の唯一の境界表現。z-index 19 なので、
 * StaffSectionTabs（z-index 20）を持つ画面ではタブ面がこれを覆い、二重にならない。
 */
export default function StaffShell({
  locale,
  viewportMode,
  scrolled,
  header,
  banner,
  menu,
  children,
  mainRef,
}: StaffShellProps) {
  return (
    /* data-staff-shell: html/body を staff の基底色（白）へ合わせるためのマーカー（globals.css） */
    <div lang={locale} className={styles.shell} data-staff-shell="" data-viewport={viewportMode}>
      {header}
      <div className={styles.headerFade} data-scrolled={scrolled} aria-hidden="true" />
      {banner}
      {menu}
      {/*
        A-OK 確定ブロックを持たない画面でも上部から下スワイプできるようにする。
        tabs / confirm が内側にある場合はそちらが優先されるため、
        ここが起点になるのは「他に surface がない上部領域」だけになる。
      */}
      <main
        ref={mainRef}
        className={styles.main}
        data-viewport={viewportMode}
        data-staff-swipe-surface="content"
      >
        {children}
      </main>
    </div>
  );
}
