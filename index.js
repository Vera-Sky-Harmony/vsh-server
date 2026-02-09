
 *451
452
453
454
455
456
457
458
459
460
461
462
463
464
465
466
467
468
469
470
471
472
473
474
475
476
477
478
479
480
481
482
483
484
485
486
487
488
489
490
491
492
493
494
495
496
497
498
499
500
501
502
503
504
505
506
507
508
509
510
511
512
513
514
515
516
517
518
519
520
521
522
523
524
525
526
527
528
529
530
531
532
533
534
535
536
537
538
539
540
541
import express from "express";
      text:
        "画像を受け取りました。ありがとうございます。\n" +
        "紹介者が確認後、次の案内を行います。",
    },
  ]);
}

/**
 * ==========
 * プール割当（来た順 1→30）
 * ==========
 */
function assignFlpToUser(userId) {
  // 既に割当済みなら同じ値
  if (flpAssigned.has(userId)) return flpAssigned.get(userId).flp;

  // unused が空
  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

/**
 * ==========
 * 期限切れ（10日）で unused に戻す
 * ==========
 */
function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      if (!flpUnused.includes(v.flp)) flpUnused.push(v.flp);

      // Aへ通知（失敗してもOK）
      safePush(ADMIN_NOTIFY_USER_ID, [
        {
          type: "text",
          text:
            `【期限切れ】${TIMEOUT_DAYS}日以内に3点返信が届かなかったため、割当FLPをunusedへ戻しました。\n` +
            `userId: ${uid}\n割当FLP: ${v.flp}`,
        },
      ]).catch(() => {});
    }
  }
}

/**
 * ==========
 * 署名検証
 * ==========
 */
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  return hash === signature;
}

/**
 * ==========
 * helper
 * ==========
 */
async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (e) {
    console.error("pushMessage failed:", e?.originalError?.response?.data || e);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

app.listen(Number(PORT || 10000), () => {
  console.log("VSH server listening on port", PORT || 10000);
});

キーの切り替えに使っ
