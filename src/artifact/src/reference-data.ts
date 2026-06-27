import { buildAkshareArtifactReferenceLine, type AkshareArtifactReferenceLine } from "../../source/index.ts";

export interface ArtifactReferenceLineRequest {
  symbol: string;
  label?: string;
  start?: string;
  end?: string;
}

export type ArtifactReferenceLine = AkshareArtifactReferenceLine;

export async function fetchArtifactReferenceLine(
  request: ArtifactReferenceLineRequest,
): Promise<ArtifactReferenceLine> {
  return buildAkshareArtifactReferenceLine(
    request.symbol,
    request.label || request.symbol,
    request.start,
    request.end,
  );
}

export async function fetchArtifactReferenceLines(
  requests: ArtifactReferenceLineRequest[],
): Promise<ArtifactReferenceLine[]> {
  return Promise.all(requests.map(fetchArtifactReferenceLine));
}