import { IsString, IsOptional, IsIn } from "class-validator";

export class CreateCompetitionDto {
  @IsString()
  name: string;
}

export class UpdateCompetitionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["ACTIVE", "CLOSED"])
  status?: string;
}
