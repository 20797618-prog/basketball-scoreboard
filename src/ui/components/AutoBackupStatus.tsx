import { useEffect, useRef, useState } from 'react';
import {
  subscribeAutoBackup,
  type AutoBackupStatus,
} from '../../infrastructure/cloudbase/autoBackup';

export function AutoBackupStatus() {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeAutoBackup((s) => {
      setStatus(s);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (s) {
        hideTimerRef.current = setTimeout(() => setStatus(null), 4000);
      }
    });
  }, []);

  if (!status) return null;

  return <div className={`auto-backup-bar ${status.kind}`}>{status.text}</div>;
}
