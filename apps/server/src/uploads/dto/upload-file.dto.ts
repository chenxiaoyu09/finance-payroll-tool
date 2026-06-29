import { IsIn, IsString } from 'class-validator';

export class UploadFileDto {
  @IsString()
  @IsIn(['salary', 'performance', 'attendance', 'social', 'tax', 'other'])
  category!: string;
}
