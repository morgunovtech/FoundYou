import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BasicFileInfo } from '../../types/metadata';
import type { JpegSignals } from '../../utils/jpegQuant';
import { useT } from '../../i18n';
import { FactRow } from './FactRow';
import { FRAME_STEP_KEYS } from './storyKeys';
import {
  revokeFrameChecks,
  runFrameChecks,
  type FrameCheckResults,
  type FrameCheckStep,
  type GhostResult
} from '../../utils/frameChecks';

interface FrameChecksCardProps {
  fileInfo: BasicFileInfo;
  /** The file's own JPEG quality (from its tables), so a lower dip reads as an earlier save. */
  jpeg: JpegSignals | null;
}

type State =
  | { status: 'idle' }
  | { status: 'running'; step: FrameCheckStep }
  | { status: 'done'; results: FrameCheckResults }
  | { status: 'error' };

const CHART = { width: 320, height: 120, left: 24, right: 8, top: 12, bottom: 18 };

/** The error curve of the compression history, with the dips marked. */
const GhostChart: React.FC<{ ghosts: GhostResult; label: string }> = ({ ghosts, label }) => {
  const maxError = Math.max(...ghosts.curve.map((p) => p.error), 1e-6);
  const x = (quality: number) => CHART.left + ((quality - 40) / 60) * (CHART.width - CHART.left - CHART.right);
  const y = (error: number) => CHART.top + (1 - error / maxError) * (CHART.height - CHART.top - CHART.bottom);
  const points = ghosts.curve.map((p) => `${x(p.quality).toFixed(1)},${y(p.error).toFixed(1)}`).join(' ');
  const baseline = CHART.height - CHART.bottom;
  return (
    <svg className="fy-frame-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={label}>
      <line
        className="fy-frame-chart-axis"
        x1={CHART.left}
        y1={baseline}
        x2={CHART.width - CHART.right}
        y2={baseline}
      />
      <polyline className="fy-frame-chart-line" points={points} />
      {ghosts.dips.map((quality) => {
        const point = ghosts.curve.find((p) => p.quality === quality);
        if (!point) return null;
        return (
          <g key={quality}>
            <circle className="fy-frame-chart-dip" cx={x(quality)} cy={y(point.error)} r={4} />
            <text x={x(quality)} y={y(point.error) - 7} textAnchor="middle">
              {quality}
            </text>
          </g>
        );
      })}
      {[40, 70, 100].map((quality) => (
        <text key={quality} x={x(quality)} y={CHART.height - 4} textAnchor="middle">
          {quality}
        </text>
      ))}
    </svg>
  );
};

/**
 * «Проверка кадра»: the three pixel checks behind a button (they re-encode the picture up to
 * 32 times, so nothing runs by itself). Each result says in plain words what was done, what
 * was looked for, what came out and what it does not prove. The maps are object URLs and
 * are revoked when the file changes or the card unmounts.
 */
export const FrameChecksCard: React.FC<FrameChecksCardProps> = ({ fileInfo, jpeg }) => {
  const t = useT();
  const [state, setState] = useState<State>({ status: 'idle' });
  const resultsRef = useRef<FrameCheckResults | null>(null);
  const fileRef = useRef<File>(fileInfo.file);

  useEffect(() => {
    fileRef.current = fileInfo.file;
    revokeFrameChecks(resultsRef.current);
    resultsRef.current = null;
    setState({ status: 'idle' });
  }, [fileInfo.file]);
  useEffect(() => () => revokeFrameChecks(resultsRef.current), []);

  const run = useCallback(async () => {
    const file = fileInfo.file;
    setState({ status: 'running', step: 'decode' });
    try {
      const mime = fileInfo.originalMimeType ?? fileInfo.mimeType;
      const results = await runFrameChecks(
        file,
        { currentQuality: jpeg ? (jpeg.ijgQuality ?? jpeg.estimatedQuality) : null, isJpeg: /jpe?g$/i.test(mime) },
        (step) => setState({ status: 'running', step })
      );
      if (fileRef.current !== file) {
        revokeFrameChecks(results);
        return;
      }
      revokeFrameChecks(resultsRef.current);
      resultsRef.current = results;
      setState({ status: 'done', results });
    } catch (error) {
      console.error('frame-checks', error);
      if (fileRef.current === file) setState({ status: 'error' });
    }
  }, [fileInfo.file, fileInfo.mimeType, fileInfo.originalMimeType, jpeg]);

  const cropped = (width: number, height: number) => t('frameChecksCropped', { width, height });

  return (
    <FactRow title={t('frameChecksTitle')} severity="low" value={null} sub={t('frameChecksIntro')}>
      <div className="fy-fact-details fy-frame">
        {state.status === 'error' ? (
          <p className="fy-hint" role="alert">
            {t('frameChecksError')}
          </p>
        ) : null}
        {state.status === 'idle' || state.status === 'error' ? (
          <div className="fy-actions">
            <button type="button" className="v4-btn" onClick={run}>
              {t('frameChecksButton')}
            </button>
          </div>
        ) : null}
        {state.status === 'running' ? (
          <p className="fy-hint" role="status">
            {t('frameChecksRunning', { step: t(FRAME_STEP_KEYS[state.step]) })}
          </p>
        ) : null}
        {state.status === 'done' ? (
          <>
            <section className="fy-frame-check">
              <h4 className="v4-h3">{t('frameElaTitle')}</h4>
              <p className="fy-frame-how">{`${t('frameElaWhat')} ${t('frameElaLook')}`}</p>
              <p className="fy-frame-result">
                {state.results.ela.verdict === 'spots'
                  ? t('frameElaSpots', { count: state.results.ela.hotBlocks })
                  : t('frameElaUniform')}
              </p>
              <img
                className="fy-frame-map"
                src={state.results.ela.url}
                alt={t('frameElaAlt')}
                width={state.results.ela.width}
                height={state.results.ela.height}
              />
              <p className="fy-muted">
                {t('frameElaCaveat')}
                {state.results.ela.cropped ? ` ${cropped(state.results.ela.width, state.results.ela.height)}` : ''}
              </p>
            </section>
            <section className="fy-frame-check">
              <h4 className="v4-h3">{t('frameGhostTitle')}</h4>
              <p className="fy-frame-how">{`${t('frameGhostWhat')} ${t('frameGhostLook')}`}</p>
              <p className="fy-frame-result">
                {state.results.ghosts.verdict === 'double'
                  ? t('frameGhostDouble', {
                      first: state.results.ghosts.dips[0],
                      current: state.results.ghosts.currentQuality ?? ''
                    })
                  : state.results.ghosts.verdict === 'single'
                    ? t('frameGhostSingle', { first: state.results.ghosts.dips[0] })
                    : state.results.ghosts.verdict === 'jpeg-inside'
                      ? t('frameGhostInside', { first: state.results.ghosts.dips[0] })
                      : state.results.ghosts.verdict === 'unreliable'
                        ? t('frameGhostUnreliable')
                        : t('frameGhostNone')}
              </p>
              <GhostChart ghosts={state.results.ghosts} label={t('frameGhostAlt')} />
              <p className="fy-muted">{t('frameGhostCaveat')}</p>
            </section>
            <section className="fy-frame-check">
              <h4 className="v4-h3">{t('frameNoiseTitle')}</h4>
              <p className="fy-frame-how">{`${t('frameNoiseWhat')} ${t('frameNoiseLook')}`}</p>
              <p className="fy-frame-result">
                {state.results.noise.verdict === 'flat'
                  ? t('frameNoiseFlat')
                  : state.results.noise.verdict === 'spots'
                    ? t('frameNoiseSpots', {
                        outliers: state.results.noise.outliers,
                        judged: state.results.noise.judged,
                        percent: Math.round(state.results.noise.share * 100)
                      })
                    : t('frameNoiseUniform', { judged: state.results.noise.judged })}
              </p>
              <img
                className="fy-frame-map"
                src={state.results.noise.url}
                alt={t('frameNoiseAlt')}
                width={state.results.noise.width}
                height={state.results.noise.height}
              />
              <p className="fy-muted">{t('frameNoiseCaveat')}</p>
            </section>
          </>
        ) : null}
      </div>
    </FactRow>
  );
};
