import React, { useState } from 'react';
import type { ProGroup } from '../../utils/proTable';

/** Rows shown per group before «show more»; the raw EXIF of a phone photo rarely exceeds this. */
const PRO_ROW_CAP = 200;

interface ProTableProps {
  groups: ProGroup[];
  showMoreLabel: (count: number) => string;
}

/** The raw data table: every group as a mono two-column table, long groups capped behind a button. */
export const ProTable: React.FC<ProTableProps> = ({ groups, showMoreLabel }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="fy-pro">
      {groups.map((group) => {
        const rows = expanded[group.group] ? group.rows : group.rows.slice(0, PRO_ROW_CAP);
        const hidden = group.rows.length - rows.length;
        return (
          <div key={group.group} className="fy-pro-group">
            <h3 className="v4-h3">{group.group}</h3>
            <div className="fy-table-scroll">
              <table className="fy-pro-table">
                <tbody>
                  {rows.map(([key, value], index) => (
                    <tr key={`${key}-${index}`}>
                      <td>{key}</td>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hidden > 0 ? (
              <button type="button" className="v4-btn fy-btn-sm" onClick={() => setExpanded((prev) => ({ ...prev, [group.group]: true }))}>
                {showMoreLabel(hidden)}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
