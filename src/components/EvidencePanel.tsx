import { Activity, Camera, FileVideo2, Image as ImageIcon, Link2, Trash2, Upload, Video } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { deleteEvidence, listEvidenceForRoll, saveEvidence } from '../lib/evidenceStore';
import type { AppExercise, EvidenceRecord } from '../types/exercise';

interface Props { rollId: string; exercise: AppExercise; reps: number; }

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEvidenceDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function EvidencePreview({ item, onDelete }: { item: EvidenceRecord; onDelete: (id: string) => void }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(item.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [item.blob]);

  return (
    <article className="evidence-item">
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
          <Activity size={13}/>
          <b>{item.reps}×</b>
          <span>{item.exerciseName}</span>
        </span>

        <small>{formatBytes(item.size)}</small>
      </div>

      <button className="evidence-delete" type="button" onClick={() => onDelete(item.id)} aria-label={`Eliminar ${item.fileName}`}>
        <Trash2 size={17}/>
      </button>
    </article>
  );
}

export function EvidencePanel({ rollId, exercise, reps }: Props) {
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

  const addFile = async (event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'video') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
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
    if (!window.confirm('¿Eliminar esta evidencia?')) return;
    await deleteEvidence(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <section className="evidence-section">
      <div className="evidence-heading">
        <div>
          <span className="eyebrow">EVIDENCIA</span>
          <h3>Guarda tu progreso</h3>
          <p>Opcional · queda guardado en este dispositivo.</p>
        </div>
        <Upload size={20}/>
      </div>

      <div className="evidence-linked-roll" aria-label="Ejercicio asociado a estas evidencias">
        <div className="evidence-linked-icon"><Link2 size={17}/></div>
        <div className="evidence-linked-copy">
          <span>Vinculada a esta tirada</span>
          <strong>{reps}× {exercise.name}</strong>
          <small>Las fotos y videos que subas aquí quedan ligados únicamente a este ejercicio.</small>
        </div>
        <span className="evidence-count">{items.length} {items.length === 1 ? 'archivo' : 'archivos'}</span>
      </div>

      <div className="evidence-actions">
        <button type="button" onClick={() => imageInput.current?.click()} disabled={saving}>
          <Camera size={18}/> Subir foto
        </button>
        <button type="button" onClick={() => videoInput.current?.click()} disabled={saving}>
          <Video size={18}/> Subir video
        </button>
        <input ref={imageInput} className="sr-only" type="file" accept="image/*" onChange={(event) => void addFile(event, 'image')} />
        <input ref={videoInput} className="sr-only" type="file" accept="video/*" onChange={(event) => void addFile(event, 'video')} />
      </div>

      {message && <p className="evidence-message">{message}</p>}
      {items.length > 0 && (
        <div className="evidence-list">
          {items.map((item) => <EvidencePreview key={item.id} item={item} onDelete={(id) => void remove(id)} />)}
        </div>
      )}
    </section>
  );
}
