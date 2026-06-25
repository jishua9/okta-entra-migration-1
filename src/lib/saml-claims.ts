import { SamlAttributeStatement } from "@/types/entra";

const OKTA_EXPR_TO_ENTRA: Record<string, { Source: string; ID: string }> = {
  "user.email": { Source: "user", ID: "mail" },
  "user.login": { Source: "user", ID: "userprincipalname" },
  "user.firstName": { Source: "user", ID: "givenname" },
  "user.lastName": { Source: "user", ID: "surname" },
  "user.displayName": { Source: "user", ID: "displayname" },
  "user.department": { Source: "user", ID: "department" },
  "user.employeeNumber": { Source: "user", ID: "employeeid" },
  "user.mobilePhone": { Source: "user", ID: "telephonenumber" },
  "user.title": { Source: "user", ID: "jobtitle" },
  "user.streetAddress": { Source: "user", ID: "streetaddress" },
  "user.city": { Source: "user", ID: "city" },
  "user.state": { Source: "user", ID: "state" },
  "user.countryCode": { Source: "user", ID: "country" },
  "user.postalCode": { Source: "user", ID: "postalcode" },
};

export interface ClaimEntry { Source: string; ID: string; SamlClaimType: string }
export interface ClaimsBuildResult { schema: ClaimEntry[]; warnings: string[] }

export function buildClaimsSchema(
  statements: SamlAttributeStatement[],
): ClaimsBuildResult {
  const warnings: string[] = [];
  const schema = statements.flatMap((stmt): ClaimEntry[] => {
    const value = stmt.values?.[0];
    if (!value) return [];
    const entra = OKTA_EXPR_TO_ENTRA[value];
    if (!entra) {
      warnings.push(`Could not map attribute "${stmt.name}" (expression: ${value}) — configure manually`);
      return [];
    }
    return [{ ...entra, SamlClaimType: stmt.name }];
  });
  return { schema, warnings };
}
