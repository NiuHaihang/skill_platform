import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MarketplaceService } from './marketplace.service';

@ApiTags('marketplace')
@Controller({ path: 'marketplace', version: '1' })
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @ApiOperation({ summary: 'Browse and search the Skill marketplace' })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['downloads', 'rating', 'created_at'] })
  @Get('skills')
  async search(
    @Query('query') query?: string,
    @Query('category') category?: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('sortBy') sortBy?: 'downloads' | 'rating' | 'created_at',
  ) {
    const { data, total } = await this.marketplaceService.search({
      query, category, page, limit, sortBy,
    });
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit!),
    };
  }

  @ApiOperation({ summary: 'Get featured Skills' })
  @Get('skills/featured')
  async getFeatured() {
    return this.marketplaceService.getFeatured();
  }
}
