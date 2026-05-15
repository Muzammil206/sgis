import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { lodgmentApi, applicationApi, refApi, uploadApi } from '@/lib/api.js';
import { exportToCSV } from '@/lib/csv.js';
import { PageHeader, PageContent } from '@/components/layout/AppLayout.jsx';
import {
  Button, Badge, Table, Pagination, SearchBar, Modal,
  Input, Select, Textarea, SurveyorAutocomplete, SectionDivider, Card, FileUploader,
} from '@/components/ui/index.jsx';
import { fmt, QUARTERS, YEARS } from '@/lib/utils.js';
import { useAuthStore } from '@/store/auth.js';
import CoordinateInput from '@/components/CoordinateInput.jsx';

export default function Lodgments() {
  const navigate    = useNavigate();
  const [sp]        = useSearchParams();
  const { user }    = useAuthStore();
  const qc          = useQueryClient();
  const [page, setPage]               = useState(1);
  const [q, setQ]                     = useState('');
  const [certStatus, setCertStatus]   = useState('');
  const [showCreate, setShowCreate]   = useState(sp.get('new') === '1');

  const params = { page, limit: 20, ...(q && { q }), ...(certStatus && { certStatus }) };
  const { data, isLoading } = useQuery(
    ['lodgments', params],
    () => lodgmentApi.list(params).then(r => r.data)
  );
  const { data: lgas } = useQuery('lgas', () => refApi.lgas().then(r => r.data));

  const columns = [
    {
      key: 'plan_number', label: 'Plan Number',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--forest)', fontWeight: 600 }}>{v}</span>,
    },
    { key: 'owner_name',    label: 'Land Owner' },
    { key: 'surveyor_name', label: 'Surveyor' },
    {
      key: 'pillars_used', label: 'Pillars Used',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{v}</span>,
    },
    {
      key: 'actual_area_sqm', label: 'Actual Area (m²)',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{Number(v).toLocaleString('en-NG', { maximumFractionDigits: 3 })}</span>,
    },
    {
      key: 'lga', label: 'LGA',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v}</span>,
    },
    {
      key: 'date_lodged', label: 'Date Lodged',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--s500)' }}>{fmt.date(v)}</span>,
    },
    {
      key: 'quarter', label: 'Quarter',
      render: (v, row) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v} {row.year}</span>,
    },
    {
      key: 'certificate_no', label: 'Certificate No.',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: v ? 'var(--forest)' : 'var(--s300)' }}>{v || '—'}</span>,
    },
    { key: 'certificate_status', label: 'Cert. Status', render: v => <Badge status={v} /> },
  ];

  const handleExport = () => {
    if (!data?.data?.length) return;
    exportToCSV(
      [
        ['Plan Number', 'Land Owner', 'Surveyor', 'Reg. No.', 'Pillars Used', 'Actual Area sqm', 'Location', 'LGA', 'Date Lodged', 'Quarter', 'Cert No.', 'Cert Status'],
        ...data.data.map(r => [
          r.plan_number, r.owner_name, r.surveyor_name, r.surveyor_reg_no,
          r.pillars_used, r.actual_area_sqm, r.location, r.lga,
          r.date_lodged, r.quarter, r.certificate_no, r.certificate_status,
        ]),
      ],
      'SurveyorLodgments'
    );
  };

  return (
    <>
      <PageHeader
        title="Surveyor Lodgments"
        subtitle="DB2 — Post-fieldwork plan lodgments and Lodgement Certificate issuance"
        badge="DB2"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={handleExport}
              icon={<svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}>
              Export
            </Button>
            {user?.role !== 'viewer' && (
              <Button
                onClick={() => setShowCreate(true)}
                icon={<svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
              >
                New Lodgment
              </Button>
            )}
          </div>
        }
      />
      <PageContent>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBar value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Plan number, land owner, surveyor…" style={{ flex: 1 }} />
          <Select value={certStatus} onChange={e => { setCertStatus(e.target.value); setPage(1); }} style={{ width: 170 }}
            options={[
              { value: '',         label: 'All cert statuses' },
              { value: 'draft',    label: 'Draft'             },
              { value: 'reviewed', label: 'Reviewed'          },
              { value: 'issued',   label: 'Issued'            },
            ]} />
        </div>

        <Card>
          <div style={{ padding: '10px 14px', background: 'var(--s50)', borderBottom: '1px solid var(--s200)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--s500)' }}>
              {isLoading ? 'Loading…' : `${data?.total ?? 0} records`}
            </span>
          </div>
          <Table columns={columns} data={data?.data} loading={isLoading} keyField="plan_number"
            emptyMessage="No surveyor lodgments found"
            onRowClick={row => navigate(`/lodgments/${encodeURIComponent(row.plan_number)}`)} />
          <Pagination page={page} totalPages={data?.totalPages || 1} onChange={setPage} />
        </Card>
      </PageContent>

      <CreateLodgmentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        lgas={lgas}
        defaultPlan={sp.get('plan') || ''}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries('lodgments'); }}
      />
    </>
  );
}

/* ─── Create Lodgment Modal — with DB1 auto-fill + standalone mode ─────── */
function CreateLodgmentModal({ open, onClose, lgas, defaultPlan, onSuccess }) {
  const { register, handleSubmit, setValue, watch, formState: { errors }, reset } = useForm({
    defaultValues: { planNumber: defaultPlan, pillarPrefix: 'SC/KW', coordinateSystem: 'U.T.M. Zone 31 / Minna Datum', scale: '1:500' },
  });
  const [selectedSurveyor, setSelectedSurveyor] = useState(null);
  const [uploadStatus,     setUploadStatus]     = useState({});
  const [apiError,         setApiError]         = useState('');
  const [db1Status,        setDb1Status]        = useState('idle'); // 'idle'|'loading'|'found'|'not_found'
  const [db1Record,        setDb1Record]        = useState(null);   // the DB1 application if found
  const [pillars,          setPillars]          = useState([]);     // current tag list
  const [pillarInput,      setPillarInput]      = useState('');     // typed value in the input
  const [coordData,        setCoordData]        = useState({});     // coordinate input state

  // Pillar tag helpers
  const addPillar = (val) => {
    const trimmed = val.trim().toUpperCase();
    if (!trimmed) return;
    if (!pillars.includes(trimmed)) setPillars(p => [...p, trimmed]);
    setPillarInput('');
  };
  const removePillar = (p) => setPillars(prev => prev.filter(x => x !== p));
  const handlePillarKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && pillarInput.trim()) {
      e.preventDefault();
      addPillar(pillarInput);
    }
    if (e.key === 'Backspace' && !pillarInput && pillars.length) {
      setPillars(p => p.slice(0, -1));
    }
  };

  const timerRef = useRef(null);
  const handlePlanNumberChange = useCallback((e) => {
    const val = e.target.value;
    setValue('planNumber', val);
    clearTimeout(timerRef.current);
    if (val.length < 8) { setDb1Status('idle'); setDb1Record(null); return; }
    timerRef.current = setTimeout(async () => {
      setDb1Status('loading');
      try {
        const res = await applicationApi.getByPlan(val.trim());
        const pa  = res.data.application;
        setValue('surveyorId',    pa.surveyor_id);
        setValue('surveyorName',  pa.surveyor_name);
        setValue('surveyorRegNo', pa.surveyor_reg_no);
        setValue('firmName',      pa.firm_name || '');
        setValue('location',      pa.location);
        setValue('lga',           pa.lga);
        setValue('quarter',       pa.quarter);
        setValue('year',          String(pa.year));
        setValue('pillarPrefix',  pa.pillar_prefix);
        setSelectedSurveyor({ name: pa.surveyor_name, surveyorReg: pa.surveyor_reg_no });
        // Auto-fill pillar tags from DB1 issued list
        setPillars(pa.pillar_numbers || []);
        setDb1Record(pa);
        setDb1Status('found');
      } catch {
        setDb1Status('not_found');
        setDb1Record(null);
        // Don't clear pillars — user may have already typed some
      }
    }, 600);
  }, [setValue]);

  const onSurveyorSelect = s => {
    setSelectedSurveyor(s);
    setValue('surveyorId',    s.id);
    setValue('surveyorName',  s.name);
    setValue('surveyorRegNo', s.surveyorReg);
    setValue('firmName',      s.firmName || '');
  };

  const handleFile = async (type, field, file) => {
    if (!file) return;
    setUploadStatus(p => ({ ...p, [type]: 'uploading' }));
    try {
      const res = await uploadApi.upload(type, file);
      setValue(field, res.data.url);
      setUploadStatus(p => ({ ...p, [type]: 'done' }));
    } catch {
      setUploadStatus(p => ({ ...p, [type]: 'error' }));
    }
  };

  const mutation = useMutation(data => lodgmentApi.create(data), {
    onSuccess: () => {
      reset();
      setSelectedSurveyor(null);
      setUploadStatus({});
      setApiError('');
      setDb1Status('idle');
      setDb1Record(null);
      setPillars([]);
      setPillarInput('');
      onSuccess();
    },
    onError: err => setApiError(err.response?.data?.error || 'An error occurred.'),
  });

  const submit = handleSubmit(data => {
    if (!pillars.length) { setApiError('Add at least one pillar number.'); return; }
    setApiError('');
    mutation.mutate({
      ...data,
      pillarNumbers:        pillars,
      pillarsUsed:          pillars.length,
      actualAreaSqm:        Number(data.actualAreaSqm),
      year:                 Number(data.year),
      // Coordinate / GIS fields from CoordinateInput component
      coordinateSystemType: coordData.coordinateSystem || null,
      utmNorthing:          coordData.utmNorthing      || null,
      utmEasting:           coordData.utmEasting       || null,
      townshipNorthing:     coordData.townshipNorthing  || null,
      townshipEasting:      coordData.townshipEasting   || null,
      wgs84Lat:             coordData.wgs84Lat ? Number(coordData.wgs84Lat) : null,
      wgs84Lng:             coordData.wgs84Lng ? Number(coordData.wgs84Lng) : null,
    });
  });

  // Derived: which pillars differ from DB1?
  const issuedSet   = new Set(db1Record?.pillar_numbers || []);
  const addedExtra  = pillars.filter(p => issuedSet.size > 0 && !issuedSet.has(p));
  const removedFrom = [...issuedSet].filter(p => !pillars.includes(p));

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title="New Surveyor Lodgment"
      subtitle="DB2 — Post-fieldwork lodgment. Works with or without a matching Pillar Application (DB1)."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={mutation.isLoading}>Save &amp; Generate Certificate</Button></>}
    >
      {apiError && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 13.5, color: '#991B1B', marginBottom: 16 }}>
          {apiError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>

        {/* ── Plan Number ── */}
        <SectionDivider label="Plan Number — auto-fills from DB1 if found" />
        <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--s500)' }}>
            Plan Number <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              {...register('planNumber', { required: true })}
              onChange={handlePlanNumberChange}
              placeholder="KW/3465/47/2024"
              style={{ width: '100%', height: 36, padding: '0 36px 0 10px', background: '#fff', border: `1px solid ${errors.planNumber ? '#EF4444' : 'var(--s200)'}`, borderRadius: 'var(--radius-sm)', fontSize: 13.5, fontFamily: 'var(--font-mono)', color: 'var(--forest)', outline: 'none', boxShadow: 'var(--shadow-xs)' }}
              onFocus={e => e.target.style.borderColor = 'var(--emerald)'}
              onBlur={e => e.target.style.borderColor = errors.planNumber ? '#EF4444' : 'var(--s200)'}
            />
            {db1Status === 'loading' && (
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid var(--emerald-mid)', borderTopColor: 'var(--emerald)', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
            )}
          </div>
          {db1Status === 'found' && (
            <div style={{ padding: '8px 12px', background: 'var(--emerald-light)', border: '1px solid var(--emerald-mid)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--emerald)' }}>
              ✓ DB1 record found — surveyor, location, quarter and {db1Record?.pillar_numbers?.length} pillars auto-filled
            </div>
          )}
          {db1Status === 'not_found' && (
            <div style={{ padding: '8px 12px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#9A3412' }}>
              ℹ No DB1 record found — this will be a standalone lodgment. Fill in surveyor and pillars manually below.
            </div>
          )}
        </div>

        {/* ── Surveyor ── */}
        <SectionDivider label="Surveyor — auto-filled from DB1 or select manually" />
        <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--s500)' }}>
            Surveyor <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <SurveyorAutocomplete onSelect={onSurveyorSelect} value={selectedSurveyor} />
          {selectedSurveyor && (
            <div style={{ padding: '6px 12px', background: 'var(--emerald-light)', border: '1px solid var(--emerald-mid)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--emerald)' }}>
              ✓ {selectedSurveyor.name} · Reg. {selectedSurveyor.surveyorReg}
            </div>
          )}
        </div>
        <Input label="Firm Name" placeholder="Auto-filled from DB1" {...register('firmName')} />
        <div />

        {/* ── Land Owner ── */}
        <SectionDivider label="Land Owner" />
        <Input label="Land Owner Name" required {...register('ownerName', { required: true })} error={errors.ownerName && 'Required'} />
        <div />

        {/* ── Pillar Tag Editor ── */}
        <SectionDivider label="Pillar Numbers — click × to remove, type to add new" />
        <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Tag input box */}
          <div
            style={{
              minHeight: 44, padding: '6px 8px', background: '#fff',
              border: '1px solid var(--s200)', borderRadius: 'var(--radius-sm)',
              display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
              cursor: 'text', boxShadow: 'var(--shadow-xs)',
            }}
            onClick={e => e.currentTarget.querySelector('input')?.focus()}
          >
            {pillars.map(p => {
              const isExtra   = issuedSet.size > 0 && !issuedSet.has(p);
              return (
                <span key={p} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500,
                  padding: '2px 6px 2px 8px', borderRadius: 4,
                  background: isExtra ? '#FFF7ED' : 'var(--emerald-light)',
                  color:      isExtra ? '#9A3412' : 'var(--emerald)',
                  border:     `1px solid ${isExtra ? '#FED7AA' : 'var(--emerald-mid)'}`,
                }}>
                  {p}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removePillar(p); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, color: 'inherit', opacity: 0.6, fontSize: 13, fontWeight: 700 }}
                    title="Remove"
                  >×</button>
                </span>
              );
            })}
            <input
              value={pillarInput}
              onChange={e => setPillarInput(e.target.value.toUpperCase())}
              onKeyDown={handlePillarKeyDown}
              onBlur={() => { if (pillarInput.trim()) addPillar(pillarInput); }}
              placeholder={pillars.length ? '' : 'Type a pillar number and press Space or Enter…'}
              style={{
                border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font-mono)',
                color: 'var(--forest)', flex: '1 1 140px', minWidth: 140, background: 'transparent',
                padding: '2px 4px',
              }}
            />
          </div>

          {/* Counts row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <span style={{ color: 'var(--s500)' }}>{pillars.length} pillar{pillars.length !== 1 ? 's' : ''} entered</span>
            {db1Record && (
              <>
                <span style={{ color: 'var(--s400)' }}>·</span>
                <span style={{ color: 'var(--s500)' }}>{db1Record.pillar_numbers?.length} issued in DB1</span>
              </>
            )}
          </div>

          {/* Diff warnings */}
          {addedExtra.length > 0 && (
            <div style={{ padding: '7px 12px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, fontSize: 12, color: '#9A3412' }}>
              ⚠ <strong>{addedExtra.length} pillar{addedExtra.length > 1 ? 's' : ''} not in DB1</strong> (shown in orange): {addedExtra.join(', ')}
            </div>
          )}
          {removedFrom.length > 0 && (
            <div style={{ padding: '7px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 12, color: '#92400E' }}>
              ℹ <strong>{removedFrom.length} DB1 pillar{removedFrom.length > 1 ? 's' : ''} removed</strong> — these were issued but won't be used: {removedFrom.join(', ')}
            </div>
          )}
          {db1Record && addedExtra.length === 0 && removedFrom.length === 0 && pillars.length > 0 && (
            <div style={{ padding: '7px 12px', background: 'var(--emerald-light)', border: '1px solid var(--emerald-mid)', borderRadius: 6, fontSize: 12, color: 'var(--emerald)' }}>
              ✓ Pillar numbers match DB1 exactly
            </div>
          )}
        </div>

        {/* ── Measurements ── */}
        <SectionDivider label="Actual Measurements" />
        <Input label="Actual Area (m²)" required type="number" step="0.001" placeholder="e.g. 966.997"
          {...register('actualAreaSqm', { required: true })} error={errors.actualAreaSqm && 'Required'} />
        <Input label="Scale" required placeholder="1:500" {...register('scale', { required: true })} error={errors.scale && 'Required'} />
        {/* ── Coordinates / GIS — Optional ── */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CoordinateInput value={coordData} onChange={setCoordData} />
        </div>

        {/* ── Dates & Quarter ── */}
        <SectionDivider label="Dates & Quarter" />
        <Input label="Date of Survey" required type="date" {...register('dateOfSurvey', { required: true })} error={errors.dateOfSurvey && 'Required'} />
        <Input label="Date Signed"    required type="date" {...register('dateSigned',   { required: true })} error={errors.dateSigned && 'Required'} />
        <Input label="Date Lodged at OSG" required type="date" {...register('dateLodged', { required: true })} error={errors.dateLodged && 'Required'}
          hint="Physical lodgment date — may differ from today" />
        <div />
        <Select label="Quarter" required placeholder="— Select —"
          options={QUARTERS.map(q => ({ value: q, label: q }))}
          {...register('quarter', { required: true })} error={errors.quarter && 'Required'} />
        <Select label="Year" required placeholder="— Select —"
          options={YEARS.map(y => ({ value: y, label: String(y) }))}
          {...register('year', { required: true })} error={errors.year && 'Required'} />

        {/* ── Location ── */}
        <SectionDivider label="Location" />
        <div style={{ gridColumn: '1/-1' }}>
          <Textarea label="Location / Address" required placeholder="Auto-fills from DB1 — or enter manually" {...register('location', { required: true })} error={errors.location && 'Required'} />
        </div>
        <Select label="LGA" required placeholder="— Select LGA —"
          options={(lgas || []).map(l => ({ value: l.name, label: l.name }))}
          {...register('lga', { required: true })} error={errors.lga && 'Required'} />

        {/* ── Document Uploads ── */}
        <SectionDivider label="Document Uploads (optional — can be added later via Edit)" />
        <FileUploader label="Survey Plan Scan (PDF/image)"  type="plan"     status={uploadStatus.plan}     onChange={f => handleFile('plan',     'planScanUrl',    f)} />
        <FileUploader label="Surveyor Stamp Image"          type="stamp"    status={uploadStatus.stamp}    onChange={f => handleFile('stamp',    'stampImageUrl',  f)} />
        <FileUploader label="RED COPY Scan (PDF/image)"     type="red_copy" status={uploadStatus.red_copy} onChange={f => handleFile('red_copy', 'redCopyScanUrl', f)} />

        <div style={{ gridColumn: '1/-1' }}>
          <Textarea label="Notes (optional)" {...register('notes')} />
        </div>
      </div>
    </Modal>
  );
}