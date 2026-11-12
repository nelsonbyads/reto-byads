import { Check, FileVideo2, Image as ImageIcon, Send, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { backend } from "../../lib/backend";
import { formatShortDateTime as formatDate, formatFileSize as formatBytes } from "../../lib/format";
import { EvidenceRow, EvidenceView, ParticipantRow } from "./model";

export function GymBattleEvidence({
  participant,
  canUpload,
  canReview,
  onChanged,
}: {
  participant: ParticipantRow;
  canUpload: boolean;
  canReview: boolean;
  onChanged: () => Promise<void>;
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!backend) return;
    const client = backend;
    setLoading(true);
    setError("");
    const { data, error: evidenceError } = await client
      .from("challenge_evidence")
      .select(
        "id, participant_id, evidence_kind, storage_path, file_name, size_bytes, created_at",
      )
      .eq("participant_id", participant.id)
      .order("created_at", { ascending: false });

    if (evidenceError) {
      setError(evidenceError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as EvidenceRow[];
    const hydrated = await Promise.all(
      rows.map(async (row): Promise<EvidenceView> => {
        const { data: signed } = await client.storage
          .from("challenge-evidence")
          .createSignedUrl(row.storage_path, 3600);
        return { ...row, signedUrl: signed?.signedUrl ?? null };
      }),
    );
    setItems(hydrated);
    setLoading(false);
  }, [participant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (
      !file ||
      !user ||
      user.provider !== "cloud" ||
      !backend ||
      !canUpload
    )
      return;
    if (file.size > 50 * 1024 * 1024) {
      setError("El archivo supera el límite de 50 MB.");
      return;
    }
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("Sube una imagen o video compatible.");
      return;
    }

    const client = backend;
    setUploading(true);
    setError("");
    setMessage("");
    const safeName =
      file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "evidence";
    const path = `${user.id}/${participant.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await client.storage
      .from("challenge-evidence")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (storageError) {
      setUploading(false);
      setError(storageError.message);
      return;
    }

    const { error: rowError } = await client.from("challenge_evidence").insert({
      participant_id: participant.id,
      evidence_kind: isImage ? "image" : "video",
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
    if (rowError) {
      await client.storage.from("challenge-evidence").remove([path]);
      setUploading(false);
      setError(rowError.message);
      return;
    }
    setUploading(false);
    setMessage("Evidencia cargada. Ya puedes enviarla a revisión.");
    await load();
  };

  const remove = async (item: EvidenceView) => {
    if (!backend || !canUpload || !window.confirm("¿Eliminar esta evidencia?"))
      return;
    const client = backend;
    const { error: dbError } = await client
      .from("challenge_evidence")
      .delete()
      .eq("id", item.id);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    await client.storage.from("challenge-evidence").remove([item.storage_path]);
    await load();
  };

  const submit = async () => {
    if (!backend || !canUpload || items.length === 0) return;
    setActing(true);
    setError("");
    setMessage("");
    const { error: rpcError } = await backend.rpc(
      "submit_organization_battle",
      { p_participant_id: participant.id },
    );
    setActing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage("Evidencia enviada al Gym rival.");
    await onChanged();
  };

  const review = async (decision: "approved" | "rejected") => {
    if (!backend || !canReview) return;
    setActing(true);
    setError("");
    setMessage("");
    const { data, error: rpcError } = await backend.rpc(
      "review_organization_battle",
      {
        p_participant_id: participant.id,
        p_decision: decision,
        p_notes: notes.trim() || null,
      },
    );
    setActing(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as {
      reward_blocked?: boolean;
      coins_granted?: number;
      xp_granted?: number;
      sponsor_points?: number;
    } | null;
    if (decision === "rejected")
      setMessage(
        "Evidencia rechazada. El participante deberá subir una nueva.",
      );
    else if (result?.reward_blocked)
      setMessage(
        "Aporte aprobado sin recompensa adicional por política anti-farming.",
      );
    else
      setMessage(
        `Aprobado: +${result?.coins_granted ?? 25} DC · +${result?.xp_granted ?? 50} XP · +${result?.sponsor_points ?? 100} Partner Points.`,
      );
    await onChanged();
  };

  return (
    <div className="gym-battle-evidence-v121">
      <div className="gym-battle-evidence-head-v121">
        <strong>Evidencia</strong>
        {canUpload && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={15} />
            {uploading ? "Subiendo…" : "Agregar"}
          </button>
        )}
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          onChange={(event) => {
            void upload(event);
          }}
        />
      </div>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}
      {loading ? (
        <p className="gym-battle-muted-v121">Cargando evidencia…</p>
      ) : items.length === 0 ? (
        <p className="gym-battle-muted-v121">Aún no hay evidencia.</p>
      ) : (
        <div className="gym-battle-evidence-list-v121">
          {items.map((item) => (
            <article key={item.id}>
              <div className="gym-battle-evidence-preview-v121">
                {item.signedUrl && item.evidence_kind === "image" ? (
                  <img src={item.signedUrl} alt="" />
                ) : item.signedUrl ? (
                  <video src={item.signedUrl} controls preload="metadata" />
                ) : item.evidence_kind === "image" ? (
                  <ImageIcon />
                ) : (
                  <FileVideo2 />
                )}
              </div>
              <div>
                <strong>{item.file_name || "Evidencia"}</strong>
                <small>
                  {formatBytes(item.size_bytes)} · {formatDate(item.created_at)}
                </small>
              </div>
              {canUpload && (
                <button
                  type="button"
                  onClick={() => {
                    void remove(item);
                  }}
                  aria-label="Eliminar evidencia"
                >
                  <X size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {canUpload && (
        <button
          className="gym-battle-submit-v121"
          type="button"
          onClick={() => {
            void submit();
          }}
          disabled={acting || items.length === 0}
        >
          <Send size={15} />
          {participant.status === "rejected"
            ? "Volver a enviar"
            : "Enviar al Gym rival"}
        </button>
      )}
      {canReview && (
        <div className="gym-battle-review-v121">
          <label>
            Comentario opcional
            <textarea
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              className="reject"
              onClick={() => {
                void review("rejected");
              }}
              disabled={acting}
            >
              <X size={15} /> Pedir otra evidencia
            </button>
            <button
              type="button"
              onClick={() => {
                void review("approved");
              }}
              disabled={acting}
            >
              <Check size={15} /> Aprobar +100 Partner Points
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
