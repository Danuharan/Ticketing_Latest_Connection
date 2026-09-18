import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import {
  type AuditError,
  type AuditIssueType,
  type AuditIssueView,
} from '../../services/blueprint-audit.service';
import { ParkingAuditService } from '../../services/parking-audit.service';

/**
 * Shows Gemini Flash verification for CV-detected parking stalls:
 * accuracy, missing printed codes, merged/misnamed/extra issues.
 */
@Component({
  selector: 'app-parking-audit-panel',
  templateUrl: './parking-audit-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParkingAuditPanelComponent {
  protected readonly audit = inject(ParkingAuditService);

  protected focus(issue: AuditIssueView): void {
    this.audit.focusIssue(issue);
  }

  protected fix(issue: AuditIssueView): void {
    this.audit.fixIssue(issue);
  }

  protected accept(issue: AuditIssueView): void {
    this.audit.acceptIssue(issue);
  }

  protected autoFix(issue: AuditIssueView): void {
    this.audit.autoFixIssue(issue);
  }

  protected autoFixTitle(issue: AuditIssueView): string {
    return issue.type === 'extra'
      ? 'Remove this extra slot from the canvas'
      : `Rename the slot to '${issue.realBlockLabel}'`;
  }

  protected issueLabel(issue: AuditIssueView): string {
    if (issue.realBlockLabel) {
      return issue.realBlockLabel;
    }
    if (issue.type === 'malformed') {
      const seq = issue.key.match(/(\d+)$/);
      return seq ? `Broken shape ${Number(seq[1]) + 1}` : 'Broken shape';
    }
    const quoted = issue.note?.match(/'([^']+)'/);
    if (quoted) {
      return issue.type === 'extra' ? `Extra at '${quoted[1]}'` : `'${quoted[1]}'`;
    }
    return issue.type === 'extra' ? 'Extra outline' : 'Unlabelled slot';
  }

  protected typeLabel(type: AuditIssueType): string {
    switch (type) {
      case 'split':
        return 'Split';
      case 'merged':
        return 'Merged';
      case 'misnamed':
        return 'Misnamed';
      case 'extra':
        return 'Extra';
      case 'missing':
        return 'Missing';
      case 'malformed':
        return 'Bad shape';
      default:
        return type;
    }
  }

  protected canAutoFix(issue: AuditIssueView): boolean {
    return (
      (issue.type === 'misnamed' && Boolean(issue.realBlockLabel) && issue.elementIds.length > 0) ||
      (issue.type === 'extra' && issue.elementIds.length > 0)
    );
  }

  protected isAccepted(issue: AuditIssueView): boolean {
    return this.audit.acceptedKeys().has(issue.key);
  }

  protected errorTone(err: AuditError): 'warn' | 'error' {
    return err.kind === 'credits' || err.kind === 'rate-limit' ? 'warn' : 'error';
  }
}
