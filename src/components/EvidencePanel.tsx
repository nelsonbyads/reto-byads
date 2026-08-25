import { Camera, FileVideo2, Image as ImageIcon, Link2, ShieldCheck, Trash2, Video } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { deleteEvidence, listEvidenceForRoll, saveEvidence } from '../lib/evidenceStore';
import type { AppExercise, EvidenceRecord } from '../types/exercise';

interface Props {
  rollId: string;
  exercise: AppExercise;
  reps: number;
  onCountChange?: (count: number) => void;
  locked?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEvidenceDate(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    const time = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(date);
    if (sameDay) return `Hoy · ${time}`;
    return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return '';
  }
}

function EvidencePreview({ item, onDelete }: { item: EvidenceRecord; onDelete?: (id: string) => void }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(item.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [item.blob]);

  return (
    <article className="evidence-item evidence-item-v7">
      <div className="evidence-preview">
        {url && item.kind === 'image' && <img src={url} alt={`Evidencia ${item.fileName}`} />}
        {url && item.kind === 'video' && <video src={url} controls preload="metadata" />}
      </div>

      <div className="evidence-meta">
        <div className="evidence-meta-topline">
          <span className="evidence-type">
            {item.kind === 'image' ? <ImageIcon size={14}/> : <FileVideo2 size={14}/>} {item.kind === 'image' ? 'Foto' : 'Video'}
          </span>
          <small>{formatEvidenceDate(item.createdAt)}</small>
        </div>
        <strong title={item.fileName}>{item.fileName}</strong>
        <span className="evidence-workout-tag" title={`${item.reps} repeticiones de ${item.exerciseName}`}>
          <b>{item.reps}×</b><span>{item.exerciseName}</span>
        </span>
        <small>{formatBytes(item.size)}</small>
      </div>

      {onDelete && (
        <button className="evidence-delete" type="button" onClick={() => onDelete(item.id)} aria-label={`Eliminar ${item.fileName}`}>
          <Trash2 size={17}/>
        </button>
      )}
    </article>
  );
}

export function EvidencePanel({ rollId, exercise, reps, onCountChange, locked = false }: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    listEvidenceForRoll(rollId)
      .then((records) => active && setItems(records))
      .catch(() => active && setMessage('No pudimos leer las evidencias locales.'));
    return () => { active = false; };
  }, [rollId]);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  const addFile = async (event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'video') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || locked) return;
    if (file.size > 50 * 1024 * 1024) {
      setMessage('El archivo supera el límite local de 50 MB.');
      return;
    }

    setSaving(true);
    setMessage('');

    const record: EvidenceRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rollId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      reps,
      kind,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      createdAt: Date.now(),
    };

    try {
      await saveEvidence(record);
      setItems((current) => [record, ...current]);
    } catch {
      setMessage('No pudimos guardar la evidencia en este navegador.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (locked || !window.confirm('¿Eliminar esta evidencia?')) return;
    await deleteEvidence(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <section className="evidence-section evidence-section-v7">
      <div className="evidence-heading evidence-heading-v7">
        <div>
          <span className="eyebrow"><ShieldCheck size={14}/> EVIDENCIA DEL EJERCICIO ACTUAL</span>
          <h3>{reps}× {exercise.name}</h3>
          <p><Link2 size={13}/> Debes adjuntar al menos una evidencia para cerrar esta ronda.</p>
        </div>
        <span className="evidence-count-v7">{items.length}<small>{items.length === 1 ? 'archivo' : 'archivos'}</small></span>
      </div>

      <div className="evidence-actions evidence-actions-v7">
        <button type="button" onClick={() => imageInput.current?.click()} disabled={saving || locked}><Camera size={18}/> Subir foto</button>
        <button type="button" onClick={() => videoInput.current?.click()} disabled={saving || locked}><Video size={18}/> Subir video</button>
        <input ref={imageInput} className="sr-only" type="file" accept="image/*" onChange={(event) => void addFile(event, 'image')} />
        <input ref={videoInput} className="sr-only" type="file" accept="video/*" onChange={(event) => void addFile(event, 'video')} />
      </div>

      {locked && <p className="evidence-message evidence-locked-v113">Ronda cerrada: la evidencia queda bloqueada para conservar la validación.</p>}
      {message && <p className="evidence-message">{message}</p>}
      {items.length > 0 ? (
        <div className="evidence-list evidence-list-v7">
          {items.map((item) => <EvidencePreview key={item.id} item={item} onDelete={locked ? undefined : (id) => void remove(id)} />)}
        </div>
      ) : (
        <div className="evidence-empty-v7 evidence-required-v113"><ShieldCheck size={18}/><span>Sube una foto o video para habilitar “Marcar como completado”.</span></div>
      )}
    </section>
  );
}
