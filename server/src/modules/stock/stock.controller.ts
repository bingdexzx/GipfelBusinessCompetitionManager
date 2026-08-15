import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { StockService } from "./stock.service";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ReqUser } from "./stock.service";
import {
  CreateStockDto,
  UpdateStockDto,
  CreateFundsAccountDto,
  UpdateFundsAccountDto,
  CreateOrderDto,
  AdvanceRoundDto,
} from "./dto/stock.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Controller("stocks")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("stock:view")
export class StockController {
  constructor(private service: StockService) {}

  // —— 股票行情 / 基础数据（stock:view）——
  @Get()
  findAll(
    @CurrentUser() user: ReqUser,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    const cid = competitionId ? parseInt(competitionId) : user.competitionId ?? undefined;
    return this.service.findAllStocks(
      parseInt(page || "1"),
      parseInt(pageSize || "50"),
      cid,
      updatedAfter,
      requireExistingIds === "true",
    );
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOneStock(id);
  }

  @Get(":id/candles")
  candles(@Param("id", ParseIntPipe) id: number) {
    return this.service.getCandles(id);
  }

  // —— 股票增删改（stock:manage）——
  @Post()
  @RequirePermissions("stock:manage")
  create(@CurrentUser() user: ReqUser, @Body() dto: CreateStockDto) {
    return this.service.createStock(user, dto);
  }

  @Patch(":id")
  @RequirePermissions("stock:manage")
  update(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateStockDto) {
    return this.service.updateStock(user, id, dto);
  }

  @Delete(":id")
  @RequirePermissions("stock:manage")
  remove(
    @CurrentUser() user: ReqUser,
    @Param("id", ParseIntPipe) id: number,
    @Query("competitionId") competitionId?: string,
  ) {
    return this.service.removeStock(user, id, competitionId ? parseInt(competitionId) : undefined);
  }

  // —— 资金账户（stock:edit 及以上；范围受控）——
  @Get("accounts/list")
  listAccounts(@CurrentUser() user: ReqUser, @Query("competitionId") competitionId?: string) {
    const cid = competitionId ? parseInt(competitionId) : user.competitionId ?? undefined;
    if (!cid) return [];
    return this.service.findAllFundsAccounts(user, cid);
  }

  @Get("accounts/:id")
  getAccount(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number) {
    return this.service.findOneFundsAccount(user, id);
  }

  @Get("accounts/:id/holdings")
  accountHoldings(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number) {
    return this.service.getAccountHoldings(user, id);
  }

  @Post("accounts")
  @RequirePermissions("stock:edit")
  createAccount(@CurrentUser() user: ReqUser, @Body() dto: CreateFundsAccountDto) {
    return this.service.createFundsAccount(user, dto);
  }

  @Patch("accounts/:id")
  @RequirePermissions("stock:edit")
  updateAccount(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateFundsAccountDto) {
    return this.service.updateFundsAccount(user, id, dto);
  }

  @Delete("accounts/:id")
  @RequirePermissions("stock:edit")
  removeAccount(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number) {
    return this.service.removeFundsAccount(user, id);
  }

  // —— 订单（stock:view 即可买卖）——
  @Get("orders/list")
  listOrders(
    @CurrentUser() user: ReqUser,
    @Query("competitionId") competitionId?: string,
    @Query("stockId") stockId?: string,
  ) {
    const cid = competitionId ? parseInt(competitionId) : user.competitionId ?? undefined;
    if (!cid) return [];
    return this.service.findOrders(user, cid, stockId ? parseInt(stockId) : undefined);
  }

  @Post("orders")
  place(@CurrentUser() user: ReqUser, @Body() dto: CreateOrderDto) {
    return this.service.placeOrder(user, dto);
  }

  @Delete("orders/:id")
  cancel(@CurrentUser() user: ReqUser, @Param("id", ParseIntPipe) id: number) {
    return this.service.cancelOrder(user, id);
  }

  // —— 持仓（stock:view）——
  @Get("holdings/list")
  listHoldings(
    @CurrentUser() user: ReqUser,
    @Query("competitionId") competitionId?: string,
    @Query("accountId") accountId?: string,
  ) {
    const cid = competitionId ? parseInt(competitionId) : user.competitionId ?? undefined;
    if (!cid) return [];
    return this.service.findHoldings(user, cid, accountId ? parseInt(accountId) : undefined);
  }

  // —— 推进轮次（stock:manage）——
  @Post("advance-round")
  @RequirePermissions("stock:manage")
  advance(
    @CurrentUser() user: ReqUser,
    @Query("competitionId") competitionId?: string,
    @Body() dto: AdvanceRoundDto = {},
  ) {
    const cid = competitionId ? parseInt(competitionId) : user.competitionId;
    if (!cid) throw new Error("缺少比赛上下文");
    return this.service.advanceRound(user, cid, dto);
  }
}
