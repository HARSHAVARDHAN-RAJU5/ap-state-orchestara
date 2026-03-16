import db from "../db.js";

export default class PolicyEngine {

  static async loadAllConfigs(organization_id) {

    const approvalRes = await db.query(
      `
      SELECT min_amount, max_amount, approver_role
      FROM approval_config
      WHERE organization_id = $1
      ORDER BY min_amount ASC
      `,
      [organization_id]
    );

    const matchingRes = await db.query(
      `
      SELECT *
      FROM matching_tolerance_config
      WHERE organization_id = $1
      `,
      [organization_id]
    );

    const taxRes = await db.query(
      `
      SELECT *
      FROM tax_rules_config
      WHERE organization_id = $1
      `,
      [organization_id]
    );

    const paymentRes = await db.query(
      `
      SELECT *
      FROM payment_policy_config
      WHERE organization_id = $1
      `,
      [organization_id]
    );

    const approvalLevels = approvalRes.rows.map(row => ({
      min_amount: parseFloat(row.min_amount),
      max_amount: parseFloat(row.max_amount),
      approver_role: row.approver_role
    }));

    const highValueThreshold = approvalLevels.length
      ? Math.max(...approvalLevels.map(l => l.min_amount))
      : Infinity;

    const matchingConfig = matchingRes.rows[0] || {
      price_variance_percentage: 0.02
    };

    const taxConfig = taxRes.rows[0] || {};

    const paymentConfig = paymentRes.rows[0] || {
      default_due_days: 30,
      max_retry_count: 2,
      default_payment_method: "BANK_TRANSFER"
    };
    
    return {
      approval: {
        levels: approvalLevels,
        high_value_threshold: highValueThreshold
      },
      matching: matchingConfig,
      tax: taxConfig,
      payment: paymentConfig
    };
  }
}