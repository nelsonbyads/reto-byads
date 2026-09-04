import { ArrowLeft, CheckCircle2, Mail, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../styles/v14-admin.css';

const TYPES = [
  ['support','Soporte'],['commercial','Solicitud comercial'],['advertising','Quiero pautar'],['gym_registration','Registrar un Gym'],['brand_registration','Registrar una Marca'],['report','Reportar un problema'],['other','Otro'],
] as const;
type RequestType = typeof TYPES[number][0];
const VALID_TYPES = new Set<string>(TYPES.map(([value]) => value));

export function ContactPage() {
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get('type');
  const initialType = requestedType && VALID_TYPES.has(requestedType) ? requestedType as RequestType : 'support';
  const [form,setForm]=useState({name:'',email:'',company:'',type:initialType as string,subject:'',message:''});
  const [acceptedPolicy,setAcceptedPolicy]=useState(false);
  const [sending,setSending]=useState(false); const [success,setSuccess]=useState(false); const [error,setError]=useState('');

  useEffect(() => {
    if (requestedType && VALID_TYPES.has(requestedType)) setForm((current) => ({ ...current, type: requestedType }));
  }, [requestedType]);

  const submit=async(e:FormEvent)=>{e.preventDefault();setSending(true);setError('');if(!supabase){setError('Supabase no está configurado.');setSending(false);return;}const {error:rpcError}=await supabase.rpc('submit_support_request',{p_name:form.name,p_email:form.email,p_company:form.company||null,p_request_type:form.type,p_subject:form.subject,p_message:form.message});setSending(false);if(rpcError){setError(rpcError.message);return;}setSuccess(true);};
  return <main className="contact-page-v14"><section className="contact-brand-v14"><Link to="/" className="contact-back-v14"><ArrowLeft size={16}/> Volver a DadoFit</Link><div><span className="contact-mark-v14"><Mail/></span><span className="eyebrow">DADOFIT</span><h1>¿Cómo podemos ayudarte?</h1><p>Soporte, alianzas comerciales, pauta deportiva, registro de organizaciones o reportes. Tu solicitud llegará directamente al Backoffice de DadoFit.</p></div></section><section className="contact-panel-v14">{success?<div className="contact-success-v14"><CheckCircle2 size={42}/><h2>Solicitud recibida</h2><p>Tu caso ya quedó registrado en DadoFit.</p><Link to="/">Volver al inicio</Link></div>:<form onSubmit={submit}><div><span className="eyebrow">CONTÁCTANOS</span><h2>Crear solicitud</h2></div><div className="contact-grid-v14"><label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required minLength={2}/></label><label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/></label></div><label>Empresa <small>opcional</small><input value={form.company} onChange={e=>setForm({...form,company:e.target.value})}/></label><label>Tipo de solicitud<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Asunto<input value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} required minLength={3}/></label><label>Mensaje<textarea rows={7} value={form.message} onChange={e=>setForm({...form,message:e.target.value})} required minLength={10}/></label><label className="contact-policy-v141"><input type="checkbox" checked={acceptedPolicy} onChange={e=>setAcceptedPolicy(e.target.checked)} required/><span>Acepto el tratamiento de mis datos para gestionar esta solicitud según la <Link to="/privacy">Política de privacidad</Link> y la <Link to="/data-policy">Política de tratamiento de datos</Link>.</span></label>{error&&<div className="auth-error">{error}</div>}<button className="contact-submit-v14" disabled={sending}><Send size={17}/>{sending?'Enviando…':'Enviar solicitud'}</button></form>}</section></main>;
}
