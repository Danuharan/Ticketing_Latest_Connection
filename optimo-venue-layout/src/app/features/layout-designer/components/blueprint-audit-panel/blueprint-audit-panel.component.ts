import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import {
  BlueprintAuditService,
  type AuditError,
  type AuditIssueType,
  type AuditIssueView,
} from '../../services/blueprint-audit.service';

/**
 * Shows the AI verification result for AI-detected blueprint blocks:
 * accuracy rate, imperfect detections (split/merged/misnamed/extra) and
 * missing blocks. Clicking an issue highlights it on the canvas.
 */
@Component({
  selector: 'app-blueprint-audit-panel',
  templateUrl: './blueprint-audit-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlueprintAuditPanelComponent {
  protected readonly audit = inject(BlueprintAuditService);

  protected focus(issue: AuditIssueView): void {
    // Do not scrollIntoView here: the row was just clicked (already in view),
    // and querySelector('.audit-panel__issue--active') often still matches the
    // *previous* active row before change detection — that yanked the sidebar
    // top↔bottom on every click.
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
      ? 'Remove this extra block from the canvas'
      : `Rename the block to '${issue.realBlockLabel}'`;
  }

  /**
   * Display name for a detection issue. Extra detections have no real block,
   * so name them after the text label they cover (quoted in the note) —
   * "Unlabelled block" told the user nothing.
   */
  protected issueLabel(issue: AuditIssueView): string {
    if (issue.realBlockLabel) {
      return issue.realBlockLabel;
    }
    if (issue.type === 'malformed') {
      // Unlabelled fragments: number them so five "Bad shape" rows are
      // tellable apart ("shape-malformed-0" → "Broken shape 1").
      const seq = issue.key.match(/(\d+)$/);
      return seq ? `Broken shape ${Number(seq[1]) + 1}` : 'Broken shape';
    }
    const quoted = issue.note?.match(/'([^']+)'/);
    if (quoted) {
      return issue.type === 'extra' ? `Extra at '${quoted[1]}'` : `'${quoted[1]}'`;
    }
    return issue.type === 'extra' ? 'Extra outline' : 'Unlabelled block';
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
      case 'malformed':
        return 'Bad shape';
      default:
        return 'Missing';
    }
  }

  /**
   * Amber for external / temporary conditions (credits, rate limit, setup);
   * red for real failures (auth, network, unknown).
   */
  protected errorTone(error: AuditError): 'warn' | 'error' {
    return error.kind === 'credits' ||
      error.kind === 'rate-limit' ||
      error.kind === 'config' ||
      error.kind === 'model'
      ? 'warn'
      : 'error';
  }

  protected scoreTone(accuracyPct: number): 'good' | 'ok' | 'bad' {
    if (accuracyPct >= 90) {
      return 'good';
    }
    return accuracyPct >= 70 ? 'ok' : 'bad';
  }
}
